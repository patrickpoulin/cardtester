import { beforeEach, describe, expect, it } from 'vitest';
import { abilityKey, type CardAbility } from '../src/ai/abilities';
import { BUILTIN_BOOK } from '../src/ai/builtinBook';
import { abilityTexts, checkAbility, savedBook, translateTexts } from '../src/ai/translate';
import { deckGame } from '../src/deck';
import { parseGameYaml } from '../src/dsl/compile';
import { smokeTest } from '../src/dsl/smoke';
import { getAgent } from '../src/engine/agents';
import { Rng } from '../src/engine/rng';
import { NOT_SNAP_RULES } from '../src/games';

const blank = { summary: 's', onReveal: '', ongoingMine: '', ongoingTheirs: '', whenDestroyed: '', endOfTurn: '', unsupported: '' };
const A = (text: string, code: Partial<CardAbility>): CardAbility => ({ ...blank, text, ...code });

const DRAW = A('On Reveal: draw 2 cards.', {
  onReveal: '- draw: { from: owner.deck, to: owner.hand, count: "max(0, min(2, handLimit - len(owner.hand)))" }',
});
const DESTROY = A('On Reveal: destroy the weakest enemy card here.', {
  onReveal: `- if: "len(laneOf(opponent(owner), lane)) > 0"
  then:
    - move: { card: "minBy(laneOf(opponent(owner), lane), c => c.power)", to: "opponent(owner).destroyed" }`,
});
const AURA = A('Ongoing: your other cards here have +1 Power.', { ongoingMine: 'l == lane ? len(laneOf(owner, l)) - 1 : 0' });
const CURSE = A('Ongoing: enemy cards here have -2 Power.', { ongoingTheirs: 'l == lane ? -2 * len(laneOf(opponent(owner), l)) : 0' });
const GROW = A('At the end of your turn, this gains +1 Power.', { endOfTurn: '- add: { var: self.power, value: 1 }' });
const REVENGE = A('When this is destroyed, your cards there get +2 Power.', {
  whenDestroyed: '- forEach: { in: "laneOf(owner, lane)", as: c, do: [ { add: { var: c.power, value: 2 } } ] }',
});
const ALL = [DRAW, DESTROY, AURA, CURSE, GROW, REVENGE];

const row = (name: string, cost: number, power: number, ability?: string) => ({ name, perPlayer: 1, attrs: { cost, power, ...(ability ? { ability } : {}) } });
const DECK = [
  row('Scout', 1, 2),
  row('Lookout', 1, 1, DRAW.text),
  row('Assassin', 2, 2, DESTROY.text),
  row('Captain', 3, 3, AURA.text),
  row('Hexer', 3, 2, CURSE.text),
  row('Sapling', 2, 1, GROW.text),
  row('Martyr', 1, 1, REVENGE.text),
  row('Knight', 4, 6),
  row('Giant', 5, 9),
  row('Dragon', 6, 12, 'Draw a card.'),
];

// The browser's storage, for Node.
const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
} as Storage;
beforeEach(() => store.clear());

describe('card text translated by Claude', () => {
  it('finds each Ability text once, skipping cards with an Effect', () => {
    expect(abilityTexts([{ rows: [...DECK, { name: 'X', attrs: { effect: 'draw', amount: 1, ability: 'Old' } }, row('Y', 1, 1, '  On Reveal:  draw 2 cards. ')] }])).toHaveLength(7);
  });

  it('plays every kind of hook', () => {
    for (const a of ALL) expect(checkAbility(a), a.text).toEqual([]);
    const book = new Map(ALL.map((a) => [abilityKey(a.text), a]));
    const entry = deckGame(NOT_SNAP_RULES, DECK, 'Test', book);
    expect(smokeTest(entry.game, 50)).toEqual([]);
    const cards = parseGameYaml(entry.source).cards.flatMap((c) => ('name' in c ? [c] : []));
    expect(cards.find((c) => c.name === 'Knight')?.attrs).toMatchObject({ ai: '' });
    expect(cards.find((c) => c.name === 'Captain')?.attrs).toMatchObject({ ai: expect.stringMatching(/^a\d$/) });
    // "Draw a card." has no translation in the book, so the Dragon plays without one.
    expect(cards.find((c) => c.name === 'Dragon')?.attrs).toMatchObject({ ai: '' });
  });

  it('runs each hook in play', () => {
    const entry = deckGame(NOT_SNAP_RULES, DECK, 'Test', new Map(ALL.map((a) => [abilityKey(a.text), a])));
    const game = entry.game;
    const agent = getAgent('greedy');
    type C = { name: string; power: number; handled: boolean };
    let destroyed = 0;
    let grown = 0;
    let handled = 0;
    for (let i = 0; i < 30; i++) {
      const rng = new Rng(i + 1);
      const state = game.setup(2, rng) as { players: { destroyed: C[]; lane1: C[]; lane2: C[]; lane3: C[] }[] };
      while (!game.isTerminal(state)) game.applyAction(state, agent.choose(game, state, game.legalActions(state), rng), rng);
      for (const p of state.players) {
        destroyed += p.destroyed.length;
        handled += p.destroyed.filter((c) => c.handled).length;
        grown += [...p.lane1, ...p.lane2, ...p.lane3].filter((c) => c.name === 'Sapling' && c.power > 2).length;
      }
    }
    expect(destroyed).toBeGreaterThan(0);
    expect(handled).toBe(destroyed);
    expect(grown).toBeGreaterThan(0);
  });

  it('adds Ongoing power to the location', () => {
    const entry = deckGame(NOT_SNAP_RULES, DECK, 'Test', new Map([[abilityKey(AURA.text), AURA]]));
    const define = parseGameYaml(entry.source).define as Record<string, string>;
    expect(define.lanePower).toContain('aiMine(c, p, c.lane, l)');
    expect(define.aiTheirs).toBeUndefined();
  });

  it('comes with working translations for the example wording', () => {
    for (const a of BUILTIN_BOOK) expect(checkAbility(a), a.text).toEqual([]);
    expect(savedBook().get(abilityKey('On Reveal: Draw a card.'))?.onReveal).toContain('min(1,');
    // The wording on the example sheets plays without an API key.
    for (const text of [
      'On Reveal: draw a card.', 'On Reveal: draw 2 cards.', 'On Reveal: your other cards here get +2 power.', 'On Reveal: enemy cards here get -3 power.',
      'On Reveal: if your opponent has a card here, +3 power.', 'On Reveal: if this is your only card here, +4 power.', 'Ongoing: your other cards here have +2 power.',
    ])
      expect(savedBook().has(abilityKey(text)), text).toBe(true);
  });

  it('reports a translation that breaks in play', () => {
    const bad = A('On Reveal: nonsense.', { onReveal: '- add: { var: self.mana, value: 1 }' });
    expect(checkAbility(bad).join(' ')).toContain('self.mana');
    expect(checkAbility(A('x', { onReveal: 'not: [a list' })).length).toBeGreaterThan(0);
  });

  it('asks again for translations that fail, and keeps the ones that work', async () => {
    const asked: string[] = [];
    const answers = [
      { cards: [{ ...DRAW }, { ...GROW, endOfTurn: '- add: { var: self.mana, value: 1 }' }] },
      { cards: [{ ...GROW }] },
    ];
    const results = await translateTexts([DRAW.text, GROW.text], 'key', undefined, async (prompt) => {
      asked.push(prompt);
      return JSON.stringify(answers[asked.length - 1]);
    });
    expect(asked).toHaveLength(2);
    expect(asked[1]).toContain('self.mana');
    expect(results.map((r) => r.problems)).toEqual([[], []]);
    expect(savedBook().get(abilityKey(GROW.text))?.endOfTurn).toBe(GROW.endOfTurn);
    expect(JSON.parse(store.get('cardtester.abilities.v1')!)).toHaveLength(2);
  });
});
