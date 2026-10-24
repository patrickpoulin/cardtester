import { parseDocument } from 'yaml';
import type { Action, GameDefinition, GameResult } from '../engine/types';
import type { Rng } from '../engine/rng';
import { Env, ExprError, MISSING, RESERVED_NAMES, compileNode, parse, truthy, type Compiled, type Node, type Resolver, type Value } from './expr';
import { GameSchema, formatIssues, type ActionSpec, type Effect, type ExprSrc, type GameSpec } from './schema';

/** The file is malformed: lists every problem found, each as "path: message". */
export class GameDefinitionError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid game definition:\n${issues.map((i) => `- ${i}`).join('\n')}`);
  }
}

/** A rule failed while a game was being played, e.g. reading a property of an empty pile. */
export class RuleError extends Error {}

export type Card = { id: number; name: string; by?: number } & Record<string, Value>;
type Obj = Record<string, Value>;

export interface DslState {
  numPlayers: number;
  /** Shared variables and shared zones, by name. */
  shared: Obj;
  /** Per player: `index`, that player's variables and zones. */
  players: Obj[];
  current: number;
  turn: number;
  round: number;
  over: boolean;
  /** Every card in the game, indexed by id. */
  cards: Card[];
  /** Bumped whenever rule effects run; cached `define` values are only valid for one version. */
  version: number;
}

export interface DslAction extends Action {
  cardId?: number;
  choices?: Record<string, Value>;
}

interface Ctx {
  state: DslState;
  rng: Rng;
  /** True while a player's action or turn hooks run; moved cards then remember who moved them (`card.by`). */
  acting: boolean;
  endTurn: boolean;
  next: number | null;
}

type Run = (ctx: Ctx, env: Env) => void;

interface CompiledAction {
  id: string;
  label: string;
  when?: Compiled;
  from?: Compiled;
  where?: Compiled;
  distinct: boolean;
  choices: { name: string; options: Compiled; when?: Compiled }[];
  require?: Compiled;
  effects: Run;
  endsTurn: boolean;
  score?: Compiled;
}

const GAME_NAMES = new Set(['numPlayers', 'current', 'turn', 'round', 'me', 'players', 'card']);
const CARD_FIELDS = new Set(['id', 'name', 'by']);
const MAX_LOOP = 10_000;

const SUITS = [
  { suit: '♠', color: 'black' },
  { suit: '♥', color: 'red' },
  { suit: '♦', color: 'red' },
  { suit: '♣', color: 'black' },
];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** Parses and validates game.yaml text, then compiles it. Throws GameDefinitionError listing every problem. */
export function loadGame(text: string): GameDefinition<DslState, DslAction> {
  return compileGame(parseGameYaml(text));
}

export function parseGameYaml(text: string): GameSpec {
  const doc = parseDocument(text);
  if (doc.errors.length) throw new GameDefinitionError(doc.errors.map((e) => `YAML: ${e.message.split('\n')[0]}`));
  const parsed = GameSchema.safeParse(doc.toJS());
  if (!parsed.success) throw new GameDefinitionError(formatIssues(parsed.error.issues));
  return parsed.data;
}

export function compileGame(spec: GameSpec): GameDefinition<DslState, DslAction> {
  return new GameCompiler(spec).build();
}

class GameCompiler {
  private readonly issues: string[] = [];
  private readonly sharedZones: string[];
  private readonly playerZones: string[];
  private readonly sharedVars: Set<string>;
  private readonly defines: Record<string, Compiled> = {};
  private readonly cardEffects = new Map<string, Run>();
  private readonly rootEnvs = new WeakMap<DslState, Env>();

  constructor(private readonly spec: GameSpec) {
    this.sharedZones = Object.keys(spec.zones.shared);
    this.playerZones = Object.keys(spec.zones.player);
    this.sharedVars = new Set(Object.keys(spec.vars.shared));
  }

  build(): GameDefinition<DslState, DslAction> {
    const { spec } = this;
    this.checkNames();
    for (const [name, src] of Object.entries(spec.define)) this.defines[name] = this.expr(src, `define.${name}`);

    const cardCounts = this.compileCards();
    const setup = this.effects(spec.setup, 'setup');
    const round = spec.round && {
      setup: this.effects(spec.round.setup, 'round.setup'),
      endWhen: this.expr(spec.round.endWhen, 'round.endWhen'),
      onEnd: this.effects(spec.round.onEnd, 'round.onEnd'),
    };
    const turnStart = this.effects(spec.turn.start, 'turn.start');
    const turnEnd = this.effects(spec.turn.end, 'turn.end');
    const actions = spec.actions.map((a, i) => this.compileAction(a, `actions[${i}]`));
    const byId = new Map(actions.map((a) => [a.id, a]));
    const endWhen = this.expr(spec.endWhen, 'endWhen');
    const winners = this.expr(spec.winners, 'winners');
    const score = spec.score === undefined ? undefined : this.expr(spec.score, 'score');
    const progress = spec.progress === undefined ? undefined : this.expr(spec.progress, 'progress');
    const perPlayer = (fn: Compiled, path: string, state: DslState) => {
      const env = root(state);
      return state.players.map((p) => {
        const v = fn(env.child({ p }));
        if (typeof v !== 'number') throw new RuleError(`${path}: expected a number, got ${JSON.stringify(v)}`);
        return v;
      });
    };

    for (const id of Object.keys(spec.timing.actions ?? {})) {
      if (!byId.has(id)) this.issues.push(`timing.actions.${id}: there is no action with id "${id}"`);
    }
    if (this.issues.length) throw new GameDefinitionError(this.issues);

    const root = (state: DslState) => this.rootEnv(state);
    const actionEnv = (state: DslState, a: CompiledAction, action: DslAction): Env => {
      let env = root(state);
      if (action.cardId !== undefined) env = env.child({ card: state.cards[action.cardId] });
      if (a.choices.length) env = env.child(Object.fromEntries(a.choices.map((c) => [c.name, action.choices?.[c.name] ?? null])));
      return env;
    };
    const startTurn = (ctx: Ctx) => {
      ctx.acting = true;
      turnStart(ctx, root(ctx.state));
    };
    const timing = spec.timing;

    return {
      id: spec.id,
      name: spec.name,
      description: spec.description,
      minPlayers: spec.players.min,
      maxPlayers: spec.players.max,
      scoreLabel: spec.scoreLabel,
      scoreOrder: spec.scoreOrder,
      timing: {
        setupSeconds: timing.setup ?? 60,
        actionSeconds: (action) => timing.actions?.[action.type] ?? timing.default ?? 4,
      },

      setup: (numPlayers, rng) => {
        const state: DslState = { numPlayers, shared: {}, players: [], current: 0, turn: 1, round: 1, over: false, cards: [], version: 0 };
        for (const z of this.sharedZones) state.shared[z] = [];
        Object.assign(state.shared, structuredClone(spec.vars.shared));
        for (let i = 0; i < numPlayers; i++) {
          const p: Obj = { index: i };
          for (const z of this.playerZones) p[z] = [];
          Object.assign(p, structuredClone(spec.vars.player));
          state.players.push(p);
        }
        cardCounts(state);
        state.version++;
        const ctx: Ctx = { state, rng, acting: false, endTurn: false, next: null };
        setup(ctx, root(state));
        if (round) round.setup(ctx, root(state));
        startTurn(ctx);
        return state;
      },

      currentPlayer: (state) => state.current,

      legalActions: (state) => {
        const env = root(state);
        const out: DslAction[] = [];
        for (const a of actions) {
          if (a.when && !truthy(a.when(env))) continue;
          let cards: (Card | null)[] = [null];
          if (a.from) {
            let zone = asZone(a.from(env), `${a.id}: card.from`) as Card[];
            // Cards with the same name are interchangeable, so only one of each is considered.
            if (a.distinct) {
              const seen = new Set<string>();
              zone = zone.filter((c) => !seen.has(c.name) && seen.add(c.name));
            }
            cards = a.where ? zone.filter((c) => truthy(a.where!(env.child({ card: c })))) : zone;
          }
          for (const card of cards) {
            const cardEnv = card ? env.child({ card }) : env;
            expandChoices(a, 0, cardEnv, {}, (choices, choiceEnv) => {
              if (a.require && !truthy(a.require(choiceEnv))) return;
              const action: DslAction = { type: a.id };
              if (card) {
                action.card = card.name;
                action.cardId = card.id;
              }
              if (Object.keys(choices).length) action.choices = choices;
              out.push(action);
            });
          }
        }
        return out;
      },

      applyAction: (state, action, rng) => {
        const a = byId.get(action.type);
        if (!a) throw new RuleError(`Unknown action "${action.type}"`);
        const ctx: Ctx = { state, rng, acting: true, endTurn: a.endsTurn, next: null };
        a.effects(ctx, actionEnv(state, a, action));
        if (state.over) return;

        let turnBegins = false;
        if (ctx.endTurn) {
          turnEnd(ctx, root(state));
          if (state.over) return;
          state.current = ctx.next ?? (state.current + 1) % state.numPlayers;
          state.turn++;
          state.version++;
          turnBegins = true;
        }
        if (truthy(endWhen(root(state)))) {
          state.over = true;
          return;
        }
        if (round && truthy(round.endWhen(root(state)))) {
          ctx.acting = false;
          round.onEnd(ctx, root(state));
          state.round++;
          state.version++;
          if (state.over || truthy(endWhen(root(state)))) {
            state.over = true;
            return;
          }
          round.setup(ctx, root(state));
          turnBegins = true;
        }
        if (turnBegins) {
          ctx.endTurn = false;
          ctx.next = null;
          startTurn(ctx);
        }
      },

      isTerminal: (state) => state.over,

      result: (state): GameResult => {
        const env = root(state);
        const won = winners(env);
        const list = Array.isArray(won) ? won : [won];
        const indices = [...new Set(list.map((w) => playerIndex(w, state, 'winners')))].sort((x, y) => x - y);
        const scores = score ? perPlayer(score, 'score', state) : state.players.map(() => 0);
        return { winners: indices, scores };
      },

      progress: progress && ((state) => perPlayer(progress, 'progress', state)),

      describeAction: (_state, action) => {
        const a = byId.get(action.type);
        const parts = [a?.label ?? action.type];
        if (action.card) parts.push(action.card);
        const choices = Object.entries(action.choices ?? {}).map(([k, v]) => `${k}: ${String(v)}`);
        return parts.join(' ') + (choices.length ? ` (${choices.join(', ')})` : '');
      },

      heuristic: (state, action) => {
        const a = byId.get(action.type);
        if (!a?.score) return 0;
        const s = a.score(actionEnv(state, a, action));
        return typeof s === 'number' ? s : truthy(s) ? 1 : 0;
      },
    };
  }

  // -------------------------------------------------------------------------------------------
  // State access

  private rootEnv(state: DslState): Env {
    let env = this.rootEnvs.get(state);
    if (!env) {
      const defines = this.defines;
      // Expressions can't change the state, so a define's value holds until effects run again.
      const cache = new Map<string, { version: number; value: Value }>();
      const resolver: Resolver = {
        resolve: (name) => {
          switch (name) {
            case 'numPlayers':
              return state.numPlayers;
            case 'current':
              return state.current;
            case 'turn':
              return state.turn;
            case 'round':
              return state.round;
            case 'me':
              return state.players[state.current];
            case 'players':
              return state.players;
            case 'card':
              throw new ExprError('"card" is only available inside an action that picks a card');
          }
          if (Object.hasOwn(defines, name)) {
            const hit = cache.get(name);
            if (hit && hit.version === state.version) return hit.value;
            const value = defines[name](env!);
            cache.set(name, { version: state.version, value });
            return value;
          }
          return Object.hasOwn(state.shared, name) ? (state.shared[name] ?? null) : MISSING;
        },
      };
      env = Env.root(resolver);
      this.rootEnvs.set(state, env);
    }
    return env;
  }

  // -------------------------------------------------------------------------------------------
  // Compilation helpers

  private checkNames(): void {
    const { spec } = this;
    if (spec.players.min > spec.players.max) this.issues.push('players: min is larger than max');

    const shared = [...this.sharedZones, ...this.sharedVars, ...Object.keys(spec.define)];
    const seen = new Set<string>();
    for (const name of shared) {
      if (seen.has(name)) this.issues.push(`"${name}" is used for more than one shared zone, variable or define`);
      seen.add(name);
      if (RESERVED_NAMES.has(name) || GAME_NAMES.has(name)) this.issues.push(`"${name}" is a reserved name; choose another`);
    }
    const perPlayer = [...this.playerZones, ...Object.keys(spec.vars.player)];
    const seenPlayer = new Set<string>();
    for (const name of perPlayer) {
      if (seenPlayer.has(name)) this.issues.push(`"${name}" is used for more than one player zone or variable`);
      seenPlayer.add(name);
      if (name === 'index') this.issues.push('"index" is a reserved player field; choose another name');
    }
    const ids = new Set<string>();
    for (const a of spec.actions) {
      if (ids.has(a.id)) this.issues.push(`actions: the id "${a.id}" is used twice`);
      ids.add(a.id);
    }
  }

  private expr(src: ExprSrc | undefined, path: string): Compiled {
    if (typeof src !== 'string') {
      const v = src ?? null;
      return () => v;
    }
    try {
      return withContext(compileNode(parse(src)), path, src);
    } catch (err) {
      this.issues.push(`${path}: ${err instanceof Error ? err.message : String(err)} in "${src}"`);
      return () => null;
    }
  }

  /** Something that can be assigned: a shared variable, `current`, or a field such as me.score or p.coins. */
  private target(src: string, path: string): (env: Env, ctx: Ctx) => { get(): Value; set(v: Value): void } {
    let node: Node;
    try {
      node = parse(src);
    } catch (err) {
      this.issues.push(`${path}: ${err instanceof Error ? err.message : String(err)} in "${src}"`);
      return () => ({ get: () => null, set: () => {} });
    }
    if (node.k === 'id') {
      const name = node.name;
      if (name === 'current') {
        return (_env, ctx) => ({
          get: () => ctx.state.current,
          set: (v) => (ctx.state.current = playerIndex(v, ctx.state, path)),
        });
      }
      if (!this.sharedVars.has(name)) {
        this.issues.push(`${path}: "${name}" is not a shared variable (declare it under vars.shared, or use me.${name} for a player variable)`);
      }
      return (_env, ctx) => ({ get: () => ctx.state.shared[name], set: (v) => (ctx.state.shared[name] = v) });
    }
    if (node.k === 'member') {
      const obj = withContext(compileNode(node.obj), path, src);
      const prop = node.prop;
      return (env) => {
        const o = obj(env);
        if (o === null || typeof o !== 'object' || Array.isArray(o) || !Object.hasOwn(o, prop) || CARD_FIELDS.has(prop)) {
          throw new RuleError(`${path}: "${src}" is not a variable that can be changed`);
        }
        const rec = o as Obj;
        if (Array.isArray(rec[prop])) throw new RuleError(`${path}: "${src}" is a zone; use move to change it`);
        return { get: () => rec[prop], set: (v) => (rec[prop] = v) };
      };
    }
    this.issues.push(`${path}: "${src}" can't be assigned; use a variable name such as score or me.score`);
    return () => ({ get: () => null, set: () => {} });
  }

  private compileCards(): (state: DslState) => void {
    const steps: ((state: DslState) => void)[] = [];
    const names = new Set<string>();
    const add = (state: DslState, zone: Value[], name: string, attrs: Obj) => {
      const card = { ...attrs, id: state.cards.length, name } as Card;
      state.cards.push(card);
      zone.push(card);
    };

    this.spec.cards.forEach((entry, i) => {
      const path = `cards[${i}]`;
      if ('deck' in entry) {
        const zone = this.sharedZone(entry.zone ?? 'deck', `${path}.zone`);
        steps.push((state) => {
          for (const { suit, color } of SUITS) {
            RANKS.forEach((rank, r) => {
              const name = rank + suit;
              add(state, state.shared[zone] as Value[], name, { rank, suit, color, value: r + 1, rankHigh: r === 0 ? 14 : r + 1 });
            });
          }
        });
        for (const { suit } of SUITS) for (const rank of RANKS) names.add(rank + suit);
        return;
      }

      if (names.has(entry.name)) this.issues.push(`${path}: a card named "${entry.name}" is already defined`);
      names.add(entry.name);
      for (const key of Object.keys(entry.attrs ?? {})) {
        if (CARD_FIELDS.has(key)) this.issues.push(`${path}.attrs.${key}: "${key}" is set automatically; use another name`);
      }
      if (entry.onPlay) this.cardEffects.set(entry.name, this.effects(entry.onPlay, `${path}.onPlay`));
      const attrs = entry.attrs ?? {};

      const sharedCount = entry.count ?? (entry.perPlayer ? 0 : 1);
      if (sharedCount !== 0) {
        const zone = this.sharedZone(entry.zone ?? 'deck', `${path}.zone`);
        const count = this.expr(sharedCount, `${path}.count`);
        steps.push((state) => {
          const n = asCount(count(this.rootEnv(state)), `${path}.count`);
          for (let k = 0; k < n; k++) add(state, state.shared[zone] as Value[], entry.name, attrs);
        });
      }
      if (entry.perPlayer) {
        const zone = this.playerZone(entry.perPlayer.zone, `${path}.perPlayer.zone`);
        const count = this.expr(entry.perPlayer.count, `${path}.perPlayer.count`);
        steps.push((state) => {
          const n = asCount(count(this.rootEnv(state)), `${path}.perPlayer.count`);
          for (const p of state.players) for (let k = 0; k < n; k++) add(state, p[zone] as Value[], entry.name, attrs);
        });
      }
    });
    return (state) => steps.forEach((s) => s(state));
  }

  private sharedZone(name: string, path: string): string {
    if (!this.sharedZones.includes(name)) this.issues.push(`${path}: "${name}" is not a shared zone (zones.shared)`);
    return name;
  }

  private playerZone(name: string, path: string): string {
    if (!this.playerZones.includes(name)) this.issues.push(`${path}: "${name}" is not a player zone (zones.player)`);
    return name;
  }

  private compileAction(spec: ActionSpec, path: string): CompiledAction {
    return {
      id: spec.id,
      label: spec.label ?? spec.id,
      when: spec.when === undefined ? undefined : this.expr(spec.when, `${path}.when`),
      from: spec.card && this.expr(spec.card.from, `${path}.card.from`),
      where: spec.card?.where === undefined ? undefined : this.expr(spec.card.where, `${path}.card.where`),
      distinct: spec.card?.distinct ?? true,
      choices: Object.entries(spec.choose ?? {}).map(([name, c]) => {
        if (RESERVED_NAMES.has(name) || GAME_NAMES.has(name)) this.issues.push(`${path}.choose.${name}: "${name}" is a reserved name`);
        return {
          name,
          options: this.expr(c.options, `${path}.choose.${name}.options`),
          when: c.when === undefined ? undefined : this.expr(c.when, `${path}.choose.${name}.when`),
        };
      }),
      require: spec.require === undefined ? undefined : this.expr(spec.require, `${path}.require`),
      effects: this.effects(spec.effects, `${path}.effects`),
      endsTurn: spec.endsTurn ?? true,
      score: spec.score === undefined ? undefined : this.expr(spec.score, `${path}.score`),
    };
  }

  private effects(list: Effect[], path: string): Run {
    const runs = list.map((e, i) => this.effect(e, `${path}[${i}]`));
    return (ctx, env) => {
      for (const run of runs) {
        ctx.state.version++;
        run(ctx, env);
        ctx.state.version++;
        if (ctx.state.over) return;
      }
    };
  }

  private effect(e: Effect, path: string): Run {
    if ('move' in e) {
      const m = e.move;
      const to = this.expr(m.to, `${path}.move.to`);
      const bottom = m.position === 'bottom';
      if (m.from === undefined) {
        const single = m.card !== undefined;
        const which = this.expr(single ? m.card : m.cards, `${path}.move.${single ? 'card' : 'cards'}`);
        return (ctx, env) => {
          const v = which(env);
          const cards = single ? [asCard(v, `${path}.move.card`)] : asZone(v, `${path}.move.cards`).map((c) => asCard(c, `${path}.move.cards`));
          const dest = asZone(to(env), `${path}.move.to`);
          for (const card of cards) {
            removeCard(ctx.state, card, path);
            place(ctx, dest, [card], bottom);
          }
        };
      }
      const from = this.expr(m.from, `${path}.move.from`);
      const count = this.expr(m.count ?? 1, `${path}.move.count`);
      return (ctx, env) => {
        const src = asZone(from(env), `${path}.move.from`);
        const dest = asZone(to(env), `${path}.move.to`);
        const n = m.all ? src.length : asCount(count(env), `${path}.move.count`);
        place(ctx, dest, src.splice(Math.max(0, src.length - n)), bottom);
      };
    }

    if ('draw' in e) {
      const d = e.draw;
      const from = this.expr(d.from, `${path}.draw.from`);
      const to = this.expr(d.to, `${path}.draw.to`);
      const count = this.expr(d.count ?? 1, `${path}.draw.count`);
      const refill = d.refill && this.expr(d.refill.from, `${path}.draw.refill.from`);
      const keepTop = d.refill?.keepTop ?? 0;
      return (ctx, env) => {
        const src = asZone(from(env), `${path}.draw.from`);
        const dest = asZone(to(env), `${path}.draw.to`);
        const n = asCount(count(env), `${path}.draw.count`);
        for (let k = 0; k < n; k++) {
          if (src.length === 0 && refill) {
            const pile = asZone(refill(env), `${path}.draw.refill.from`);
            src.push(...pile.splice(0, Math.max(0, pile.length - keepTop)));
            ctx.rng.shuffle(src);
          }
          if (src.length === 0) break;
          place(ctx, dest, [src.pop()!], false);
        }
      };
    }

    if ('deal' in e) {
      const d = e.deal;
      const from = this.expr(d.from, `${path}.deal.from`);
      const zone = this.playerZone(d.to, `${path}.deal.to`);
      const count = this.expr(d.count, `${path}.deal.count`);
      return (ctx, env) => {
        const src = asZone(from(env), `${path}.deal.from`);
        const n = asCount(count(env), `${path}.deal.count`);
        for (let k = 0; k < n; k++) {
          for (const p of ctx.state.players) {
            if (src.length === 0) return;
            (p[zone] as Value[]).push(src.pop());
          }
        }
      };
    }

    if ('shuffle' in e) {
      const zone = this.expr(e.shuffle, `${path}.shuffle`);
      return (ctx, env) => void ctx.rng.shuffle(asZone(zone(env), `${path}.shuffle`));
    }

    if ('set' in e || 'add' in e) {
      const isAdd = 'add' in e;
      const spec = 'add' in e ? e.add : e.set;
      const target = this.target(spec.var, `${path}.${isAdd ? 'add' : 'set'}.var`);
      const value = this.expr(spec.value, `${path}.${isAdd ? 'add' : 'set'}.value`);
      return (ctx, env) => {
        const t = target(env, ctx);
        const v = value(env);
        if (!isAdd) return t.set(v);
        const old = t.get();
        if (typeof old !== 'number' || typeof v !== 'number') {
          throw new RuleError(`${path}.add: both "${spec.var}" and the value must be numbers`);
        }
        t.set(old + v);
      };
    }

    if ('if' in e) {
      const test = this.expr(e.if, `${path}.if`);
      const then = this.effects(e.then, `${path}.then`);
      const otherwise = e.else ? this.effects(e.else, `${path}.else`) : null;
      return (ctx, env) => {
        if (truthy(test(env))) then(ctx, env);
        else otherwise?.(ctx, env);
      };
    }

    if ('forEach' in e) {
      const { as } = e.forEach;
      const items = this.expr(e.forEach.in, `${path}.forEach.in`);
      const body = this.effects(e.forEach.do, `${path}.forEach.do`);
      return (ctx, env) => {
        const list = items(env);
        if (!Array.isArray(list)) throw new RuleError(`${path}.forEach.in: expected a list`);
        for (const item of [...list]) {
          body(ctx, env.child({ [as]: item }));
          if (ctx.state.over) return;
        }
      };
    }

    if ('while' in e) {
      const test = this.expr(e.while, `${path}.while`);
      const body = this.effects(e.do, `${path}.do`);
      return (ctx, env) => {
        for (let k = 0; truthy(test(env)); k++) {
          if (k >= MAX_LOOP) throw new RuleError(`${path}: while loop ran ${MAX_LOOP} times; is its condition ever false?`);
          body(ctx, env);
          if (ctx.state.over) return;
        }
      };
    }

    if ('runCard' in e) {
      const which = this.expr(e.runCard, `${path}.runCard`);
      return (ctx, env) => {
        const card = asCard(which(env), `${path}.runCard`);
        this.cardEffects.get(card.name)?.(ctx, env.child({ card }));
      };
    }

    if ('nextPlayer' in e) {
      const who = this.expr(e.nextPlayer, `${path}.nextPlayer`);
      return (ctx, env) => void (ctx.next = playerIndex(who(env), ctx.state, `${path}.nextPlayer`));
    }

    if ('endTurn' in e) return (ctx) => void (ctx.endTurn = true);
    return (ctx) => void (ctx.state.over = true); // endGame
  }
}

function expandChoices(
  a: CompiledAction,
  i: number,
  env: Env,
  picked: Record<string, Value>,
  emit: (choices: Record<string, Value>, env: Env) => void,
): void {
  if (i === a.choices.length) return emit(picked, env);
  const c = a.choices[i];
  if (c.when && !truthy(c.when(env))) return expandChoices(a, i + 1, env.child({ [c.name]: null }), picked, emit);
  const options = c.options(env);
  if (!Array.isArray(options)) throw new RuleError(`${a.id}: choose.${c.name}.options must be a list`);
  for (const opt of options) expandChoices(a, i + 1, env.child({ [c.name]: opt }), { ...picked, [c.name]: opt }, emit);
}

function place(ctx: Ctx, dest: Value[], cards: Value[], bottom: boolean): void {
  if (ctx.acting) for (const c of cards) (c as Card).by = ctx.state.current;
  if (bottom) dest.unshift(...cards);
  else dest.push(...cards);
}

function removeCard(state: DslState, card: Card, path: string): void {
  if (removeFrom(state.shared, card)) return;
  for (const p of state.players) if (removeFrom(p, card)) return;
  throw new RuleError(`${path}: card ${card.name} is not in any zone`);
}

function removeFrom(holder: Obj, card: Card): boolean {
  for (const key in holder) {
    const z = holder[key];
    if (!Array.isArray(z)) continue;
    const i = z.indexOf(card);
    if (i >= 0) {
      z.splice(i, 1);
      return true;
    }
  }
  return false;
}

function asZone(v: Value, path: string): Value[] {
  if (!Array.isArray(v)) throw new RuleError(`${path}: expected a zone (a list of cards), got ${v === null ? 'nothing' : typeof v}`);
  return v;
}

function asCard(v: Value, path: string): Card {
  if (v === null || typeof v !== 'object' || Array.isArray(v) || typeof (v as Card).id !== 'number') {
    throw new RuleError(`${path}: expected a card, got ${v === null ? 'nothing' : Array.isArray(v) ? 'a list' : typeof v}`);
  }
  return v as Card;
}

function asCount(v: Value, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new RuleError(`${path}: expected a count of 0 or more, got ${JSON.stringify(v)}`);
  return Math.floor(v);
}

function playerIndex(v: Value, state: DslState, path: string): number {
  const i = typeof v === 'number' ? v : v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj).index : undefined;
  if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= state.numPlayers) {
    throw new RuleError(`${path}: expected a player or player number, got ${JSON.stringify(v)}`);
  }
  return i;
}

/** Adds the file location and source text to errors raised while evaluating an expression. */
function withContext(fn: Compiled, path: string, src: string): Compiled {
  return (env) => {
    try {
      return fn(env);
    } catch (err) {
      if (err instanceof ExprError) throw new RuleError(`${path}: ${err.message} (in "${src}")`);
      throw err;
    }
  };
}
