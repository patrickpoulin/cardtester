import { describe, expect, it } from 'vitest';
import { Env, compile, type Value } from '../src/dsl/expr';

const run = (src: string, locals: Record<string, Value> = {}) => compile(src)(Env.root().child(locals));

describe('expressions', () => {
  it('follows operator precedence', () => {
    expect(run('1 + 2 * 3')).toBe(7);
    expect(run('(1 + 2) * 3')).toBe(9);
    expect(run('10 - 4 - 3')).toBe(3);
    expect(run('-2 * 3')).toBe(-6);
    expect(run('7 % 3 == 1 and not 2 > 3')).toBe(true);
    expect(run('1 < 2 ? "yes" : "no"')).toBe('yes');
    expect(run('false ? 1 : true ? 2 : 3')).toBe(2);
  });

  it('supports both word and symbol logic operators, short-circuiting', () => {
    expect(run('true && false || true')).toBe(true);
    expect(run('!true')).toBe(false);
    expect(run('x != null and x.a == 1', { x: null })).toBe(false); // right side never evaluated
    expect(run('x ?? 5', { x: null })).toBe(5);
    expect(run('if(true, 1, missing.thing)')).toBe(1);
  });

  it('reads properties and indexes lists', () => {
    const card = { name: 'Q♠', suit: '♠', value: 12 };
    expect(run('card.suit', { card })).toBe('♠');
    expect(run('card.missing', { card })).toBe(null);
    expect(run('xs[0] + xs[-1]', { xs: [1, 2, 3] })).toBe(4);
    expect(run("'♠' in ['♠', '♥']")).toBe(true);
    expect(run("'♦' not in ['♠', '♥']")).toBe(true);
  });

  it('supports lambdas and list functions', () => {
    const hand = [
      { suit: '♠', value: 3 },
      { suit: '♥', value: 12 },
      { suit: '♠', value: 9 },
    ];
    expect(run("count(hand, c => c.suit == '♠')", { hand })).toBe(2);
    expect(run('sum(hand, c => c.value)', { hand })).toBe(24);
    expect(run('maxBy(hand, c => c.value).suit', { hand })).toBe('♥');
    expect(run('map(filter(hand, c => c.value > 5), c => c.value)', { hand })).toEqual([12, 9]);
    expect(run('top(hand).value + bottom(hand).value', { hand })).toBe(12);
    expect(run('((a, b) => a * b)(6, 7)')).toBe(42);
    expect(run('len(lowest([3, 1, 1, 2], x => x))')).toBe(2);
    expect(run('max(map(hand, c => c.value))', { hand })).toBe(12);
    expect(run('max([])')).toBe(null);
  });

  it('reports syntax errors with a position', () => {
    expect(() => compile('1 +')).toThrow(/position 4/);
    expect(() => compile('a.')).toThrow(/property name/);
    expect(() => compile("'open")).toThrow(/Unclosed string/);
    expect(() => compile('a = 1')).toThrow(/Unexpected character "="/);
  });

  it('reports runtime errors clearly', () => {
    expect(() => run('nope + 1')).toThrow(/Unknown name "nope"/);
    expect(() => run('x.suit', { x: null })).toThrow(/Can't read "suit" of nothing/);
    expect(() => run("'a' * 2")).toThrow(/needs a number/);
    expect(() => run('len(5)')).toThrow(/len\(\) needs a list/);
  });

  it("can't reach JavaScript internals", () => {
    const card = { name: 'A♠' };
    expect(run('card.constructor', { card })).toBe(null);
    expect(run('card.__proto__', { card })).toBe(null);
    expect(run("card['constructor']", { card })).toBe(null);
    expect(() => run('card.toString()', { card })).toThrow(/not a function/);
  });
});
