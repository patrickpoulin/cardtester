import { describe, expect, it } from 'vitest';
import { playGame, runBatch, type SimConfig } from '../src/engine/simulate';
import { computeStats, wilson } from '../src/engine/stats';
import { Rng } from '../src/engine/rng';
import { crazyEights } from '../src/games/crazyEights';

const config = (numPlayers: number, agents = ['greedy']): SimConfig => ({
  gameId: 'crazy-eights',
  numPlayers,
  agents: Array.from({ length: numPlayers }, (_, i) => agents[i % agents.length]),
  seed: 42,
});

describe('simulator', () => {
  it('is deterministic for a given seed', () => {
    expect(runBatch(config(4), 0, 50)).toEqual(runBatch(config(4), 0, 50));
  });

  it('gives the same games however the run is split', () => {
    const whole = runBatch(config(4), 0, 40);
    const split = [...runBatch(config(4), 0, 15), ...runBatch(config(4), 15, 25)];
    expect(split).toEqual(whole);
  });

  it('finishes every game with a winner for 2-7 players', () => {
    for (let players = 2; players <= 7; players++) {
      for (const r of runBatch(config(players, ['random', 'greedy']), 0, 200)) {
        expect(r.hitActionLimit).toBe(false);
        expect(r.winners.length).toBeGreaterThan(0);
      }
    }
  });

  it('rejects bad configs', () => {
    expect(() => runBatch(config(8), 0, 1)).toThrow(/2-7 players/);
    expect(() => runBatch({ ...config(4), agents: ['nope', 'nope', 'nope', 'nope'] }, 0, 1)).toThrow(/Unknown agent/);
  });

  it('produces a readable trace', () => {
    const { log } = playGame(config(3), 0, true);
    expect(log[0]).toMatch(/^Turn 1 · Player 1: /);
    expect(log[log.length - 1]).toMatch(/^Game over/);
  });
});

describe('stats', () => {
  it('win rates and no-winner rate add up to 100%', () => {
    const records = runBatch(config(4, ['greedy', 'random']), 0, 300);
    const s = computeStats(records, config(4, ['greedy', 'random']));
    const total = s.seats.reduce((sum, seat) => sum + seat.winRate, 0) + s.noWinnerRate;
    expect(total).toBeCloseTo(1, 6);
    expect(s.turnHistogram.reduce((sum, b) => sum + b.count, 0)).toBe(300);
  });

  it('greedy beats random', () => {
    const cfg = config(2, ['greedy', 'random']);
    const s = computeStats(runBatch(cfg, 0, 1000), cfg);
    expect(s.seats[0].winRate).toBeGreaterThan(s.seats[1].winRate);
  });

  it('wilson interval contains the observed rate', () => {
    const [lo, hi] = wilson(30, 100);
    expect(lo).toBeLessThan(0.3);
    expect(hi).toBeGreaterThan(0.3);
  });
});

describe('crazy eights rules', () => {
  it('only offers plays that match suit or rank, or an eight', () => {
    const rng = new Rng(7);
    for (let g = 0; g < 50; g++) {
      const state = crazyEights.setup(4, rng);
      for (let step = 0; step < 200 && !crazyEights.isTerminal(state); step++) {
        const legal = crazyEights.legalActions(state);
        const top = state.discard[state.discard.length - 1];
        for (const a of legal) {
          if (a.type !== 'play') continue;
          const ok = a.card.startsWith('8') || a.card.endsWith(state.activeSuit) || a.card.slice(0, -1) === top.slice(0, -1);
          expect(ok).toBe(true);
        }
        crazyEights.applyAction(state, rng.pick(legal), rng);
      }
    }
  });

  it('never loses or duplicates cards', () => {
    const rng = new Rng(3);
    const state = crazyEights.setup(5, rng);
    for (let step = 0; step < 500 && !crazyEights.isTerminal(state); step++) {
      crazyEights.applyAction(state, rng.pick(crazyEights.legalActions(state)), rng);
      const all = [...state.hands.flat(), ...state.drawPile, ...state.discard];
      expect(new Set(all).size).toBe(52);
      expect(all.length).toBe(52);
    }
  });
});
