/*
 * The expression language used inside game.yaml files, e.g.
 *   card.suit == ledSuit or not any(me.hand, c => c.suit == ledSuit)
 *
 * Expressions are parsed once and compiled to closures; nothing is ever passed to eval().
 * They can only read data (game state, cards, local names) and call the built-in functions
 * below, which matters because rule files may be written by an LLM from an uploaded rulebook.
 */

export class ExprError extends Error {}

export type Value = unknown;
export type Compiled = (env: Env) => Value;

/** Returned by a Resolver for names it doesn't know. */
export const MISSING: unique symbol = Symbol('missing');

/** Supplies game-level names (shared variables, `me`, `players`, ...) to the outermost scope. */
export interface Resolver {
  resolve(name: string): Value | typeof MISSING;
}

export class Env {
  private constructor(
    private readonly locals: Record<string, Value>,
    private readonly parent: Env | null,
    private readonly resolver: Resolver | null,
  ) {}

  static root(resolver: Resolver | null = null): Env {
    return new Env({}, null, resolver);
  }

  child(locals: Record<string, Value>): Env {
    return new Env(locals, this, null);
  }

  lookup(name: string): Value {
    for (let env: Env | null = this; env; env = env.parent) {
      if (Object.hasOwn(env.locals, name)) return env.locals[name];
      if (env.resolver) {
        const v = env.resolver.resolve(name);
        if (v !== MISSING) return v;
      }
    }
    if (Object.hasOwn(BUILTINS, name)) return BUILTINS[name];
    throw new ExprError(`Unknown name "${name}"`);
  }
}

// ---------------------------------------------------------------------------------------------
// Tokenizer

type Token =
  | { t: 'num'; v: number; pos: number }
  | { t: 'str'; v: string; pos: number }
  | { t: 'id'; v: string; pos: number }
  | { t: 'op'; v: string; pos: number }
  | { t: 'end'; pos: number };

const OPERATORS = ['=>', '==', '!=', '<=', '>=', '&&', '||', '??', '<', '>', '+', '-', '*', '/', '%', '(', ')', '[', ']', ',', '.', '!', '?', ':'];

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9]/.test(ch)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i))!;
      tokens.push({ t: 'num', v: Number(m[0]), pos: i });
      i += m[0].length;
    } else if (ch === "'" || ch === '"') {
      const end = src.indexOf(ch, i + 1);
      if (end < 0) throw new ExprError(`Unclosed string starting at position ${i + 1}`);
      tokens.push({ t: 'str', v: src.slice(i + 1, end), pos: i });
      i = end + 1;
    } else if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      tokens.push({ t: 'id', v: m[0], pos: i });
      i += m[0].length;
    } else {
      const op = OPERATORS.find((o) => src.startsWith(o, i));
      if (!op) throw new ExprError(`Unexpected character "${ch}" at position ${i + 1}`);
      tokens.push({ t: 'op', v: op, pos: i });
      i += op.length;
    }
  }
  tokens.push({ t: 'end', pos: src.length });
  return tokens;
}

// ---------------------------------------------------------------------------------------------
// Parser

export type Node =
  | { k: 'lit'; v: Value }
  | { k: 'id'; name: string }
  | { k: 'list'; items: Node[] }
  | { k: 'member'; obj: Node; prop: string }
  | { k: 'index'; obj: Node; idx: Node }
  | { k: 'call'; callee: Node; args: Node[] }
  | { k: 'unary'; op: string; arg: Node }
  | { k: 'bin'; op: string; l: Node; r: Node }
  | { k: 'cond'; test: Node; then: Node; else: Node }
  | { k: 'lambda'; params: string[]; body: Node };

const KEYWORDS = new Set(['and', 'or', 'not', 'in', 'true', 'false', 'null']);

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.i + offset, this.tokens.length - 1)];
  }

  private is(t: Token['t'], v?: string, offset = 0): boolean {
    const tok = this.peek(offset);
    return tok.t === t && (v === undefined || ('v' in tok && tok.v === v));
  }

  private isOp(...ops: string[]): boolean {
    return ops.some((op) => this.is('op', op));
  }

  private isWord(word: string, offset = 0): boolean {
    return this.is('id', word, offset);
  }

  private next(): Token {
    return this.tokens[this.i++];
  }

  private expectOp(op: string): void {
    if (!this.is('op', op)) this.fail(`Expected "${op}"`);
    this.i++;
  }

  private fail(message: string): never {
    const tok = this.peek();
    const found = tok.t === 'end' ? 'end of expression' : `"${'v' in tok ? tok.v : ''}"`;
    throw new ExprError(`${message} at position ${tok.pos + 1}, found ${found}`);
  }

  parse(): Node {
    const node = this.ternary();
    if (!this.is('end')) this.fail('Unexpected input');
    return node;
  }

  private ternary(): Node {
    const test = this.nullish();
    if (!this.isOp('?')) return test;
    this.next();
    const then = this.ternary();
    this.expectOp(':');
    return { k: 'cond', test, then, else: this.ternary() };
  }

  private nullish(): Node {
    let l = this.or();
    while (this.isOp('??')) {
      this.next();
      l = { k: 'bin', op: '??', l, r: this.or() };
    }
    return l;
  }

  private or(): Node {
    let l = this.and();
    while (this.isOp('||') || this.isWord('or')) {
      this.next();
      l = { k: 'bin', op: 'or', l, r: this.and() };
    }
    return l;
  }

  private and(): Node {
    let l = this.not();
    while (this.isOp('&&') || this.isWord('and')) {
      this.next();
      l = { k: 'bin', op: 'and', l, r: this.not() };
    }
    return l;
  }

  private not(): Node {
    if (this.isWord('not')) {
      this.next();
      return { k: 'unary', op: 'not', arg: this.not() };
    }
    return this.comparison();
  }

  private comparison(): Node {
    let l = this.additive();
    for (;;) {
      if (this.isOp('==', '!=', '<', '<=', '>', '>=')) {
        const op = (this.next() as { v: string }).v;
        l = { k: 'bin', op, l, r: this.additive() };
      } else if (this.isWord('in')) {
        this.next();
        l = { k: 'bin', op: 'in', l, r: this.additive() };
      } else if (this.isWord('not') && this.isWord('in', 1)) {
        this.i += 2;
        l = { k: 'unary', op: 'not', arg: { k: 'bin', op: 'in', l, r: this.additive() } };
      } else {
        return l;
      }
    }
  }

  private additive(): Node {
    let l = this.multiplicative();
    while (this.isOp('+', '-')) {
      const op = (this.next() as { v: string }).v;
      l = { k: 'bin', op, l, r: this.multiplicative() };
    }
    return l;
  }

  private multiplicative(): Node {
    let l = this.unary();
    while (this.isOp('*', '/', '%')) {
      const op = (this.next() as { v: string }).v;
      l = { k: 'bin', op, l, r: this.unary() };
    }
    return l;
  }

  private unary(): Node {
    if (this.isOp('-')) {
      this.next();
      return { k: 'unary', op: '-', arg: this.unary() };
    }
    if (this.isOp('!')) {
      this.next();
      return { k: 'unary', op: 'not', arg: this.unary() };
    }
    return this.postfix();
  }

  private postfix(): Node {
    let node = this.primary();
    for (;;) {
      if (this.isOp('.')) {
        this.next();
        const tok = this.next();
        if (tok.t !== 'id') this.fail('Expected a property name after "."');
        node = { k: 'member', obj: node, prop: tok.v };
      } else if (this.isOp('[')) {
        this.next();
        const idx = this.ternary();
        this.expectOp(']');
        node = { k: 'index', obj: node, idx };
      } else if (this.isOp('(')) {
        this.next();
        node = { k: 'call', callee: node, args: this.args(')') };
      } else {
        return node;
      }
    }
  }

  private args(close: string): Node[] {
    const items: Node[] = [];
    if (this.isOp(close)) {
      this.next();
      return items;
    }
    for (;;) {
      items.push(this.ternary());
      if (this.isOp(',')) {
        this.next();
        continue;
      }
      this.expectOp(close);
      return items;
    }
  }

  /** True when the tokens at the cursor are `(a, b) =>`. */
  private atParenLambda(): boolean {
    let j = 1;
    if (this.is('op', ')', j)) return this.is('op', '=>', j + 1);
    for (;;) {
      if (!this.is('id', undefined, j)) return false;
      j++;
      if (this.is('op', ')', j)) return this.is('op', '=>', j + 1);
      if (!this.is('op', ',', j)) return false;
      j++;
    }
  }

  private primary(): Node {
    const tok = this.peek();
    if (tok.t === 'num' || tok.t === 'str') {
      this.next();
      return { k: 'lit', v: tok.v };
    }
    if (tok.t === 'id') {
      if (this.is('op', '=>', 1)) {
        this.i += 2;
        return { k: 'lambda', params: [tok.v], body: this.ternary() };
      }
      this.next();
      if (tok.v === 'true') return { k: 'lit', v: true };
      if (tok.v === 'false') return { k: 'lit', v: false };
      if (tok.v === 'null') return { k: 'lit', v: null };
      if (KEYWORDS.has(tok.v)) {
        this.i--;
        this.fail(`"${tok.v}" can't be used here`);
      }
      return { k: 'id', name: tok.v };
    }
    if (this.isOp('(')) {
      if (this.atParenLambda()) {
        this.next();
        const params: string[] = [];
        while (!this.isOp(')')) {
          params.push((this.next() as { v: string }).v);
          if (this.isOp(',')) this.next();
        }
        this.i += 2; // ) =>
        return { k: 'lambda', params, body: this.ternary() };
      }
      this.next();
      const inner = this.ternary();
      this.expectOp(')');
      return inner;
    }
    if (this.isOp('[')) {
      this.next();
      return { k: 'list', items: this.args(']') };
    }
    this.fail('Expected a value');
  }
}

export function parse(src: string): Node {
  return new Parser(tokenize(src)).parse();
}

// ---------------------------------------------------------------------------------------------
// Compiler

export const truthy = (v: Value): boolean => v !== null && v !== undefined && v !== false && v !== 0 && v !== '';

function eq(a: Value, b: Value): boolean {
  return (a ?? null) === (b ?? null);
}

function num(v: Value, what: string): number {
  if (typeof v !== 'number') throw new ExprError(`${what} needs a number, got ${describe(v)}`);
  return v;
}

function describe(v: Value): string {
  if (v === null || v === undefined) return 'nothing';
  if (Array.isArray(v)) return 'a list';
  if (typeof v === 'object') return 'an object';
  if (typeof v === 'function') return 'a function';
  return `${typeof v} ${JSON.stringify(v)}`;
}

function readProp(obj: Value, prop: string): Value {
  if (obj === null || obj === undefined) throw new ExprError(`Can't read "${prop}" of nothing`);
  // Own properties only, so nothing like __proto__ or constructor is reachable.
  if (typeof obj === 'object' && !Array.isArray(obj) && Object.hasOwn(obj, prop)) {
    return (obj as Record<string, Value>)[prop] ?? null;
  }
  return null;
}

function readIndex(obj: Value, idx: Value): Value {
  if (Array.isArray(obj)) {
    const i = num(idx, 'A list index');
    return obj[i < 0 ? obj.length + i : i] ?? null;
  }
  if (typeof idx === 'string') return readProp(obj, idx);
  throw new ExprError(`Can't index into ${describe(obj)}`);
}

function call(fn: Value, args: Value[]): Value {
  if (typeof fn !== 'function') throw new ExprError(`${describe(fn)} is not a function`);
  return fn(...args);
}

function binary(op: string, a: Value, b: Value): Value {
  switch (op) {
    case '==':
      return eq(a, b);
    case '!=':
      return !eq(a, b);
    case '<':
    case '<=':
    case '>':
    case '>=': {
      if (!((typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string'))) {
        throw new ExprError(`Can't compare ${describe(a)} with ${describe(b)}`);
      }
      return op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b;
    }
    case '+':
      if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
      if (typeof a === 'string' || typeof b === 'string') return `${a ?? ''}${b ?? ''}`;
      return num(a, '"+"') + num(b, '"+"');
    case '-':
      return num(a, '"-"') - num(b, '"-"');
    case '*':
      return num(a, '"*"') * num(b, '"*"');
    case '/':
      return num(a, '"/"') / num(b, '"/"');
    case '%':
      return num(a, '"%"') % num(b, '"%"');
    case 'in':
      if (Array.isArray(b)) return b.some((x) => eq(x, a));
      if (typeof b === 'string' && typeof a === 'string') return b.includes(a);
      throw new ExprError(`"in" needs a list on the right, got ${describe(b)}`);
  }
  throw new ExprError(`Unknown operator ${op}`);
}

export function compileNode(node: Node): Compiled {
  switch (node.k) {
    case 'lit': {
      const v = node.v;
      return () => v;
    }
    case 'id': {
      const name = node.name;
      return (env) => env.lookup(name);
    }
    case 'list': {
      const items = node.items.map(compileNode);
      return (env) => items.map((f) => f(env));
    }
    case 'member': {
      const obj = compileNode(node.obj);
      const prop = node.prop;
      return (env) => readProp(obj(env), prop);
    }
    case 'index': {
      const obj = compileNode(node.obj);
      const idx = compileNode(node.idx);
      return (env) => readIndex(obj(env), idx(env));
    }
    case 'call': {
      // if(test, a, b) only evaluates the branch it needs.
      if (node.callee.k === 'id' && node.callee.name === 'if') {
        if (node.args.length !== 3) throw new ExprError('if() takes 3 arguments: if(test, then, else)');
        const [test, a, b] = node.args.map(compileNode);
        return (env) => (truthy(test(env)) ? a(env) : b(env));
      }
      const callee = compileNode(node.callee);
      const args = node.args.map(compileNode);
      return (env) => call(callee(env), args.map((f) => f(env)));
    }
    case 'unary': {
      const arg = compileNode(node.arg);
      return node.op === 'not' ? (env) => !truthy(arg(env)) : (env) => -num(arg(env), 'Negation');
    }
    case 'bin': {
      const l = compileNode(node.l);
      const r = compileNode(node.r);
      if (node.op === 'and') return (env) => truthy(l(env)) && truthy(r(env));
      if (node.op === 'or') return (env) => truthy(l(env)) || truthy(r(env));
      if (node.op === '??') return (env) => l(env) ?? r(env);
      const op = node.op;
      return (env) => binary(op, l(env), r(env));
    }
    case 'cond': {
      const test = compileNode(node.test);
      const a = compileNode(node.then);
      const b = compileNode(node.else);
      return (env) => (truthy(test(env)) ? a(env) : b(env));
    }
    case 'lambda': {
      const { params } = node;
      const body = compileNode(node.body);
      return (env) =>
        (...args: Value[]) => {
          const locals: Record<string, Value> = {};
          params.forEach((p, i) => (locals[p] = args[i] ?? null));
          return body(env.child(locals));
        };
    }
  }
}

export function compile(src: string): Compiled {
  return compileNode(parse(src));
}

// ---------------------------------------------------------------------------------------------
// Built-in functions. Lists are piles: index 0 is the bottom card, the last item is the top.

function list(v: Value, fn: string): Value[] {
  if (!Array.isArray(v)) throw new ExprError(`${fn}() needs a list, got ${describe(v)}`);
  return v;
}

function numbers(args: Value[], fn: string): number[] {
  const values = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  return values.map((v) => num(v, `${fn}()`));
}

type Fn = (x: Value) => Value;
const by = (f: Value, fn: string): Fn => {
  if (typeof f !== 'function') throw new ExprError(`${fn}() needs a function such as c => c.value, got ${describe(f)}`);
  return f as Fn;
};

function extremes(l: Value, f: Value, fn: string, sign: 1 | -1): Value[] {
  const key = by(f, fn);
  let best: Value[] = [];
  let bestScore = -Infinity;
  for (const x of list(l, fn)) {
    const score = sign * num(key(x), `${fn}()`);
    if (score > bestScore) {
      bestScore = score;
      best = [x];
    } else if (score === bestScore) {
      best.push(x);
    }
  }
  return best;
}

export const BUILTINS: Record<string, (...args: Value[]) => Value> = {
  len: (x) => {
    if (Array.isArray(x) || typeof x === 'string') return x.length;
    throw new ExprError(`len() needs a list, got ${describe(x)}`);
  },
  top: (l) => list(l, 'top').at(-1) ?? null,
  bottom: (l) => list(l, 'bottom')[0] ?? null,
  filter: (l, f) => list(l, 'filter').filter((x) => truthy(by(f, 'filter')(x))),
  map: (l, f) => list(l, 'map').map((x) => by(f, 'map')(x)),
  any: (l, f) => (f === undefined ? list(l, 'any').length > 0 : list(l, 'any').some((x) => truthy(by(f, 'any')(x)))),
  all: (l, f) => list(l, 'all').every((x) => truthy(by(f, 'all')(x))),
  count: (l, f) => (f === undefined ? list(l, 'count').length : list(l, 'count').filter((x) => truthy(by(f, 'count')(x))).length),
  sum: (l, f) => list(l, 'sum').reduce<number>((s, x) => s + num(f === undefined ? x : by(f, 'sum')(x), 'sum()'), 0),
  min: (...args) => {
    const values = numbers(args, 'min');
    return values.length ? Math.min(...values) : null;
  },
  max: (...args) => {
    const values = numbers(args, 'max');
    return values.length ? Math.max(...values) : null;
  },
  maxBy: (l, f) => extremes(l, f, 'maxBy', 1)[0] ?? null,
  minBy: (l, f) => extremes(l, f, 'minBy', -1)[0] ?? null,
  highest: (l, f) => extremes(l, f, 'highest', 1),
  lowest: (l, f) => extremes(l, f, 'lowest', -1),
  contains: (l, x) => list(l, 'contains').some((y) => eq(x, y)),
  indexOf: (l, x) => list(l, 'indexOf').findIndex((y) => eq(x, y)),
  concat: (...lists) => lists.flatMap((l) => (l === null || l === undefined ? [] : list(l, 'concat'))),
  unique: (l) => [...new Set(list(l, 'unique'))],
  sortBy: (l, f) => [...list(l, 'sortBy')].sort((a, b) => num(by(f, 'sortBy')(a), 'sortBy()') - num(by(f, 'sortBy')(b), 'sortBy()')),
  reverse: (l) => [...list(l, 'reverse')].reverse(),
  range: (a, b) => {
    const [start, end] = b === undefined ? [0, num(a, 'range()')] : [num(a, 'range()'), num(b, 'range()')];
    return Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i);
  },
  abs: (x) => Math.abs(num(x, 'abs()')),
  floor: (x) => Math.floor(num(x, 'floor()')),
  ceil: (x) => Math.ceil(num(x, 'ceil()')),
  round: (x) => Math.round(num(x, 'round()')),
};

export const RESERVED_NAMES = new Set([...KEYWORDS, ...Object.keys(BUILTINS), 'if']);
