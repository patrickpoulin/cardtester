import { z } from 'zod';

/*
 * Structure of a game.yaml file. docs/game-format.md is the readable reference.
 * Fields described as expressions are strings parsed by expr.ts; YAML numbers, booleans and null
 * are taken literally. A string value that should be text must be quoted inside the expression,
 * e.g. value: "'buy'".
 */

const Expr = z.union([z.string().min(1), z.number(), z.boolean(), z.null()]);
export type ExprSrc = z.infer<typeof Expr>;

const Name = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'must be a simple name (letters, digits, underscore)');

export type Effect =
  | { move: { card?: ExprSrc; cards?: ExprSrc; from?: ExprSrc; count?: ExprSrc; all?: boolean; to: ExprSrc; position?: 'top' | 'bottom' } }
  | { draw: { from: ExprSrc; to: ExprSrc; count?: ExprSrc; refill?: { from: ExprSrc; keepTop?: number } } }
  | { deal: { from: ExprSrc; to: string; count: ExprSrc } }
  | { shuffle: ExprSrc }
  | { set: { var: string; value: ExprSrc } }
  | { add: { var: string; value: ExprSrc } }
  | { if: ExprSrc; then: Effect[]; else?: Effect[] }
  | { forEach: { in: ExprSrc; as: string; do: Effect[] } }
  | { while: ExprSrc; do: Effect[] }
  | { runCard: ExprSrc }
  | { nextPlayer: ExprSrc }
  | { endTurn: true }
  | { endGame: true };

const Effects: z.ZodType<Effect[]> = z.lazy(() => z.array(EffectSchema));

const EffectSchema: z.ZodType<Effect> = z.lazy(() =>
  z.union([
    z.strictObject({
      move: z
        .strictObject({
          card: Expr.optional(),
          cards: Expr.optional(),
          from: Expr.optional(),
          count: Expr.optional(),
          all: z.boolean().optional(),
          to: Expr,
          position: z.enum(['top', 'bottom']).optional(),
        })
        .refine((m) => [m.card, m.cards, m.from].filter((x) => x !== undefined).length === 1, {
          message: 'move needs exactly one of card, cards or from',
        }),
    }),
    z.strictObject({
      draw: z.strictObject({
        from: Expr,
        to: Expr,
        count: Expr.optional(),
        refill: z.strictObject({ from: Expr, keepTop: z.number().int().min(0).optional() }).optional(),
      }),
    }),
    z.strictObject({ deal: z.strictObject({ from: Expr, to: Name, count: Expr }) }),
    z.strictObject({ shuffle: Expr }),
    z.strictObject({ set: z.strictObject({ var: z.string().min(1), value: Expr }) }),
    z.strictObject({ add: z.strictObject({ var: z.string().min(1), value: Expr }) }),
    z.strictObject({ if: Expr, then: Effects, else: Effects.optional() }),
    z.strictObject({ forEach: z.strictObject({ in: Expr, as: Name, do: Effects }) }),
    z.strictObject({ while: Expr, do: Effects }),
    z.strictObject({ runCard: Expr }),
    z.strictObject({ nextPlayer: Expr }),
    z.strictObject({ endTurn: z.literal(true) }),
    z.strictObject({ endGame: z.literal(true) }),
  ]),
);

const Literal = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const CardEntry = z.union([
  z.strictObject({
    deck: z.enum(['standard52']),
    zone: Name.optional(),
  }),
  z.strictObject({
    name: z.string().min(1),
    count: Expr.optional(),
    zone: Name.optional(),
    perPlayer: z.strictObject({ count: Expr, zone: Name }).optional(),
    attrs: z.record(Name, Literal).optional(),
    onPlay: Effects.optional(),
  }),
]);

const Choice = z.strictObject({ options: Expr, when: Expr.optional() });

const ActionSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/, 'must use letters, digits, - or _'),
  label: z.string().optional(),
  when: Expr.optional(),
  card: z.strictObject({ from: Expr, where: Expr.optional(), distinct: z.boolean().optional() }).optional(),
  choose: z.record(Name, Choice).optional(),
  require: Expr.optional(),
  effects: Effects.default([]),
  endsTurn: z.boolean().optional(),
  score: Expr.optional(),
});

export const GameSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/, 'must use lowercase letters, digits and -'),
  name: z.string().min(1),
  description: z.string().default(''),
  players: z.strictObject({ min: z.number().int().min(1), max: z.number().int().min(1) }),
  scoreLabel: z.string().default('Score'),
  timing: z
    .strictObject({
      setup: z.number().min(0).optional(),
      default: z.number().min(0).optional(),
      actions: z.record(z.string(), z.number().min(0)).optional(),
    })
    .default({}),
  cards: z.array(CardEntry).min(1),
  zones: z.strictObject({
    shared: z.record(Name, z.strictObject({ visibility: z.enum(['hidden', 'top', 'public']).optional() })).default({}),
    player: z.record(Name, z.strictObject({ visibility: z.enum(['hidden', 'owner', 'public']).optional() })).default({}),
  }),
  vars: z
    .strictObject({
      shared: z.record(Name, Literal).default({}),
      player: z.record(Name, Literal).default({}),
    })
    .default({ shared: {}, player: {} }),
  define: z.record(Name, Expr).default({}),
  setup: Effects.default([]),
  round: z.strictObject({ setup: Effects.default([]), endWhen: Expr, onEnd: Effects.default([]) }).optional(),
  turn: z.strictObject({ start: Effects.default([]), end: Effects.default([]) }).default({ start: [], end: [] }),
  actions: z.array(ActionSchema).min(1),
  endWhen: Expr,
  winners: Expr,
  score: Expr.optional(),
});

export type GameSpec = z.infer<typeof GameSchema>;
export type ActionSpec = GameSpec['actions'][number];
export type CardSpec = z.infer<typeof CardEntry>;

/** Turns zod issues into "path: message" lines, picking the closest branch of an effect union. */
export function formatIssues(issues: readonly z.core.$ZodIssue[], base: PropertyKey[] = []): string[] {
  const out: string[] = [];
  for (const issue of issues) {
    const path = [...base, ...issue.path];
    if (issue.code === 'invalid_union' && issue.errors.length > 0) {
      // Branches that reject one of the entry's keys aren't the one the author meant. Of the
      // rest, the branch whose errors reach deepest is the closest match.
      const unknownKeys = (errs: readonly z.core.$ZodIssue[]) =>
        errs.flatMap((e) => (e.code === 'unrecognized_keys' && e.path.length === 0 ? e.keys : []));
      const candidates = issue.errors.filter((errs) => unknownKeys(errs).length === 0);
      if (candidates.length === 0) {
        const keys = [...new Set(issue.errors.flatMap(unknownKeys))].map((k) => `"${k}"`).join(', ');
        out.push(`${formatPath(path)}: not a recognised entry (unknown key ${keys}; check the spelling)`);
        continue;
      }
      const depth = (errs: readonly z.core.$ZodIssue[]) => Math.max(...errs.map((e) => e.path.length));
      out.push(...formatIssues([...candidates].sort((a, b) => depth(b) - depth(a))[0], path));
      continue;
    }
    out.push(`${formatPath(path)}: ${issue.message}`);
  }
  return out;
}

export function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return '(top level)';
  return path
    .map((p, i) => (typeof p === 'number' ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`))
    .join('');
}
