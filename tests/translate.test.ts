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

const blank = { summary: 's', onReveal: '', ongoingMine: '', ongoingTheirs: '', whenDestroyed: '', endOfTurn: '', gameStart: '', afterCardPlayed: '', whenCardDestroyed: '', unsupported: '' };
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

  describe('the newer hooks', () => {
    const COPY = A('On Reveal: copy the On Reveal of the last card you played.', {
      onReveal: `- if: "owner.lastPlayed != null and contains(revealIds, owner.lastPlayed.ai)"
  then:
    - set: { var: owner.copyReveal, value: owner.lastPlayed.ai }`,
    });
    const ANGELA = A('After you play a card here, +1 Power.', {
      afterCardPlayed: `- if: "player.index == owner.index and laneNum(player, played) == lane"
  then:
    - add: { var: self.power, value: 1 }`,
    });
    const WATCH = A('When one of your cards is destroyed, +2 Power.', {
      whenCardDestroyed: `- if: "victimOwner.index == owner.index"
  then:
    - add: { var: self.power, value: 2 }`,
    });
    const ARCANA = A('Game Start: shuffle 2 Ancient Arcana into your deck.', {
      gameStart: `- forEach:
    in: "range(2)"
    as: k
    do:
      - if: "any(pool, c => c.title == 'Ancient Arcana')"
        then:
          - move: { card: "top(filter(pool, c => c.title == 'Ancient Arcana'))", to: owner.deck }
- shuffle: owner.deck`,
    });
    const RANDOM = A('On Reveal: add a random 3-Cost card to your hand.', {
      onReveal: `- if: "len(owner.hand) < handLimit and any(pool, c => c.cost == 3)"
  then:
    - move: { card: "top(filter(pool, c => c.cost == 3))", to: owner.hand }`,
    });
    const BANISH = A('On Reveal: banish this.', { onReveal: '- move: { card: self, to: owner.banished }' });
    const SILENCE = A('On Reveal: remove the text from enemy cards here.', {
      onReveal: '- forEach: { in: "laneOf(opponent(owner), lane)", as: c, do: [ { set: { var: c.ai, value: "\'\'" } } ] }',
    });
    const NEW = [COPY, ANGELA, WATCH, ARCANA, RANDOM, BANISH, SILENCE];
    const POOL = [row('Ancient Arcana', 0, 1), row('Mystic', 3, 4), row('Sage', 3, 3, DRAW.text)];

    it('copies the On Reveal of the last card played', () => {
      const filler = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((n) => row(n, 6, 1));
      const entry = deckGame(NOT_SNAP_RULES, [row('Lookout', 1, 1, DRAW.text), row('Absorber', 1, 1, COPY.text), ...filler], 'Copy', new Map([DRAW, COPY].map((a) => [abilityKey(a.text), a])));
      const game = entry.game;
      type C = { title: string };
      type S = { players: { hand: C[]; deck: C[] }[]; current: number };
      const state = game.setup(2, new Rng(1)) as S;
      const rng = new Rng(2);
      const play = (title: string) => {
        const action = game.legalActions(state).find((a) => (a as { cardId?: number }).cardId !== undefined && JSON.stringify(a).includes('"lane":1') && state.players[state.current].hand.some((c) => c.title === title && (c as never as { id: number }).id === (a as { cardId?: number }).cardId));
        if (!action) throw new Error(`can't play ${title}: ${JSON.stringify(game.legalActions(state))}`);
        game.applyAction(state, action, rng);
      };
      // Turn 1 for both players, then turn 2: player 1 plays Lookout (draws 2) then Absorber (copies it).
      const endTurn = () => game.applyAction(state, game.legalActions(state).find((a) => JSON.stringify(a).includes('end-turn'))!, rng);
      endTurn();
      endTurn();
      // Put both cards in player 1's hand, swapping out others.
      const p1 = state.players[0];
      for (const title of ['Lookout', 'Absorber']) {
        const where = p1.hand.some((c) => c.title === title) ? null : p1.deck.findIndex((c) => c.title === title);
        if (where !== null) p1.hand.push(...p1.deck.splice(where, 1));
      }
      while (p1.hand.length > 5) p1.deck.unshift(p1.hand.splice(p1.hand.findIndex((c) => !['Lookout', 'Absorber'].includes(c.title)), 1)[0]);
      const before = p1.hand.length;
      play('Lookout');
      play('Absorber');
      // 5 in hand: Lookout played (4) draws 2 (6), Absorber played (5) copies it and draws 2 (7).
      expect(before).toBe(5);
      expect(p1.hand.length).toBe(7);
    });

    it('each works in test play', () => {
      for (const a of NEW) expect(checkAbility(a, POOL), a.text).toEqual([]);
    });

    it('play together, with a card pool', () => {
      const deck = [
        row('Absorber', 2, 2, COPY.text), row('Lookout', 1, 1, DRAW.text), row('Assassin', 2, 2, DESTROY.text), row('Angela', 2, 2, ANGELA.text),
        row('Watcher', 3, 2, WATCH.text), row('Agamotto', 5, 6, ARCANA.text), row('Agent', 1, 2, RANDOM.text), row('Ghost', 1, 3, BANISH.text),
        row('Silencer', 3, 3, SILENCE.text), row('Captain', 3, 3, AURA.text), row('Martyr', 1, 1, REVENGE.text),
      ];
      const book = new Map([...ALL, ...NEW].map((a) => [abilityKey(a.text), a]));
      const entry = deckGame(NOT_SNAP_RULES, deck, 'Hooks', book, POOL);
      expect(smokeTest(entry.game, 50)).toEqual([]);
      const agent = getAgent('greedy');
      type C = { title: string; power: number; ai: string };
      type P = { deck: C[]; hand: C[]; banished: C[]; destroyed: C[]; lane1: C[]; lane2: C[]; lane3: C[] };
      let arcana = 0, fromPool = 0, banished = 0, angela = 0, silenced = 0, watcher = 0;
      for (let i = 0; i < 40; i++) {
        const rng = new Rng(i + 1);
        const state = game().setup(2, rng) as { players: P[]; pool: C[] };
        const start = state.players.map((p) => [...p.deck, ...p.hand].filter((c) => c.title === 'Ancient Arcana').length);
        arcana += start[0] + start[1];
        while (!game().isTerminal(state)) game().applyAction(state, agent.choose(game(), state, game().legalActions(state), rng), rng);
        for (const p of state.players) {
          const all = [...p.deck, ...p.hand, ...p.destroyed, ...p.banished, ...p.lane1, ...p.lane2, ...p.lane3];
          fromPool += all.filter((c) => c.title === 'Mystic' || c.title === 'Sage').length;
          banished += p.banished.length;
          watcher += [...p.hand, ...p.deck, ...p.lane1, ...p.lane2, ...p.lane3].filter((c) => c.title === 'Watcher' && c.power > 2).length;
          angela += [...p.lane1, ...p.lane2, ...p.lane3].filter((c) => c.title === 'Angela' && c.power > 2).length;
          silenced += [...p.lane1, ...p.lane2, ...p.lane3].filter((c) => c.ai === '' && ['Captain', 'Assassin', 'Watcher'].includes(c.title)).length;
        }
      }
      function game() {
        return entry.game;
      }
      expect(arcana).toBeGreaterThan(0);
      expect(fromPool).toBeGreaterThan(0);
      expect(banished).toBeGreaterThan(0);
      expect(angela).toBeGreaterThan(0);
      expect(silenced).toBeGreaterThan(0);
      expect(watcher).toBeGreaterThan(0);
    });
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
    const results = await translateTexts([DRAW.text, GROW.text], 'key', { ask: async (prompt) => {
      asked.push(prompt);
      return JSON.stringify(answers[asked.length - 1]);
    } });
    expect(asked).toHaveLength(2);
    expect(asked[1]).toContain('self.mana');
    expect(results.map((r) => r.problems)).toEqual([[], []]);
    expect(savedBook().get(abilityKey(GROW.text))?.endOfTurn).toBe(GROW.endOfTurn);
    expect(JSON.parse(store.get('cardtester.abilities.v2')!)).toHaveLength(2);
  });
});
