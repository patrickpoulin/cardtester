import { describe, expect, it } from 'vitest';
import { GameDefinitionError, RuleError, loadGame, type DslState } from '../src/dsl/compile';
import { smokeTest } from '../src/dsl/smoke';
import { runBatch, type SimConfig } from '../src/engine/simulate';
import { computeStats } from '../src/engine/stats';
import { Rng } from '../src/engine/rng';
import type { AnyGame } from '../src/engine/types';
import { BUILTIN_GAMES } from '../src/games';
import { crazyEights as reference } from './reference/crazyEights';

const config = (game: AnyGame, numPlayers: number, agents = ['greedy']): SimConfig => ({
  gameId: game.id,
  numPlayers,
  agents: Array.from({ length: numPlayers }, (_, i) => agents[i % agents.length]),
  seed: 7,
});

const game = (id: string) => BUILTIN_GAMES.find((e) => e.game.id === id)!.game;

/** A tiny valid game: take turns drawing; first to hold 3 cards wins. */
const RACE = `
id: race
name: Race
players: { min: 2, max: 4 }
cards:
  - deck: standard52
zones:
  shared: { deck: {} }
  player: { hand: {} }
actions:
  - id: draw
    effects:
      - draw: { from: deck, to: me.hand }
endWhen: "any(players, p => len(p.hand) >= 3)"
winners: "filter(players, p => len(p.hand) >= 3)"
`;

function issuesOf(yaml: string): string[] {
  try {
    loadGame(yaml);
  } catch (err) {
    if (err instanceof GameDefinitionError) return err.issues;
    throw err;
  }
  return [];
}

describe('game.yaml validation', () => {
  it('accepts a minimal game', () => {
    expect(issuesOf(RACE)).toEqual([]);
  });

  it('reports YAML syntax errors', () => {
    expect(issuesOf('id: [unclosed')[0]).toMatch(/^YAML:/);
  });

  it('reports missing and misspelled fields with their path', () => {
    expect(issuesOf(RACE.replace(/^endWhen:.*$/m, ''))).toContainEqual(expect.stringMatching(/^endWhen:/));
    expect(issuesOf(RACE.replace('- draw: { from: deck, to: me.hand }', '- drwa: { from: deck, to: me.hand }'))).toEqual([
      'actions[0].effects[0]: not a recognised entry (unknown key "drwa"; check the spelling)',
    ]);
    expect(issuesOf(RACE.replace('- draw: { from: deck, to: me.hand }', '- draw: { from: deck }'))).toContainEqual(
      expect.stringMatching(/^actions\[0\]\.effects\[0\]\.draw\.to:/),
    );
  });

  it('reports expression syntax errors with their path', () => {
    const issues = issuesOf(RACE.replace('len(p.hand) >= 3)"\nwinners', 'len(p.hand) >= )"\nwinners'));
    expect(issues).toEqual([expect.stringMatching(/^endWhen: Expected a value at position \d+/)]);
  });

  it('checks zone and variable names', () => {
    expect(issuesOf(RACE.replace("- draw: { from: deck, to: me.hand }", "- deal: { from: deck, to: hands, count: 1 }"))).toContainEqual(
      'actions[0].effects[0].deal.to: "hands" is not a player zone (zones.player)',
    );
    expect(issuesOf(RACE.replace("- draw: { from: deck, to: me.hand }", "- set: { var: total, value: 1 }"))).toContainEqual(
      expect.stringMatching(/"total" is not a shared variable/),
    );
    expect(issuesOf(RACE.replace('shared: { deck: {} }', 'shared: { deck: {}, max: {} }'))).toContainEqual(
      '"max" is a reserved name; choose another',
    );
  });

  it('names the failing rule when something goes wrong mid-game', () => {
    const broken = loadGame(RACE.replace('endWhen: "any(players, p => len(p.hand) >= 3)"', 'endWhen: "top(deck).value > 20"'));
    expect(() => runBatch(broken, config(broken, 2), 0, 1)).toThrow(RuleError);
    expect(() => runBatch(broken, config(broken, 2), 0, 1)).toThrow(/^endWhen: .*in "top\(deck\)\.value > 20"/);
  });
});

describe('smoke test', () => {
  it('passes the built-in games', () => {
    for (const { game: g } of BUILTIN_GAMES) expect(smokeTest(g, 3)).toEqual([]);
  });

  it('catches misspelled fields and games that never end', () => {
    expect(smokeTest(loadGame(RACE.replace('to: me.hand', 'to: me.hnd')))).toEqual([
      'actions[0].effects[0].draw.to: expected a zone (a list of cards), got nothing (first seen with 2 players, test game 1)',
    ]);
    const endless = loadGame(RACE.replace('len(p.hand) >= 3)"\nwinners', 'len(p.hand) >= 99)"\nwinners').replace('- deck: standard52', '- name: Token\n    count: 0').replace('effects:\n      - draw: { from: deck, to: me.hand }', 'effects: []'));
    expect(smokeTest(endless, 2)).toEqual([expect.stringMatching(/^6 of 6 test games didn't finish/)]);
  });
});

describe('built-in games', () => {
  it.each(BUILTIN_GAMES.map((e) => e.game.id))('%s finishes every game for each player count', (id) => {
    const g = game(id);
    for (let n = g.minPlayers; n <= g.maxPlayers; n++) {
      for (const r of runBatch(g, config(g, n, ['random', 'greedy']), 0, 60)) {
        expect(r.hitActionLimit).toBe(false);
        expect(r.winners.length).toBeGreaterThan(0);
      }
    }
  });

  it.each(BUILTIN_GAMES.map((e) => e.game.id))('%s never loses or duplicates cards', (id) => {
    const g = game(id);
    const rng = new Rng(11);
    const state = g.setup(g.minPlayers, rng) as DslState;
    const zoneCards = () =>
      [...Object.values(state.shared), ...state.players.flatMap((p) => Object.values(p))].filter(Array.isArray).flat();
    for (let step = 0; step < 2000 && !g.isTerminal(state); step++) {
      g.applyAction(state, rng.pick(g.legalActions(state)), rng);
      const cards = zoneCards();
      expect(cards.length).toBe(state.cards.length);
      expect(new Set(cards).size).toBe(state.cards.length);
    }
  });

  it('crazy eights matches the hand-written reference implementation', () => {
    const dsl = game('crazy-eights');
    const agents = ['greedy', 'random'];
    const a = computeStats(dsl, runBatch(dsl, config(dsl, 4, agents), 0, 3000), config(dsl, 4, agents));
    const b = computeStats(reference, runBatch(reference, config(reference, 4, agents), 0, 3000), config(reference, 4, agents));
    a.seats.forEach((seat, i) => expect(Math.abs(seat.winRate - b.seats[i].winRate)).toBeLessThan(0.04));
    expect(Math.abs(a.turns.mean - b.turns.mean) / b.turns.mean).toBeLessThan(0.08);
  });

  it('hearts hands out 26 points per round (or 78 when someone shoots the moon)', () => {
    const g = game('hearts');
    for (const r of runBatch(g, config(g, 4, ['random', 'greedy']), 0, 40)) {
      expect(r.scores.reduce((s, x) => s + x, 0) % 26).toBe(0);
      expect(Math.max(...r.scores)).toBeGreaterThanOrEqual(100);
    }
  });

  it('greedy strategies beat random play', () => {
    for (const id of ['hearts', 'deck-builder']) {
      const g = game(id);
      const cfg = config(g, g.minPlayers, ['greedy', 'random']);
      const s = computeStats(g, runBatch(g, cfg, 0, 200), cfg);
      expect(s.seats[0].winRate).toBeGreaterThan(1.5 / g.minPlayers);
    }
  });
});
