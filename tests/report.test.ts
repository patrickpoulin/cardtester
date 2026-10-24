import { describe, expect, it } from 'vitest';
import { loadGame } from '../src/dsl/compile';
import { runBatch, type SimConfig } from '../src/engine/simulate';
import { computeStats } from '../src/engine/stats';
import { BUILTIN_GAMES } from '../src/games';
import { SIGNIFICANCE, compareSummaries, normalCdf, twoProportionP, welchP } from '../src/report/compare';
import { comparisonCsv, recordsCsv, summaryCsv } from '../src/report/csv';
import { diffLines } from '../src/report/diff';

const entry = (id: string) => BUILTIN_GAMES.find((e) => e.game.id === id)!;
const config = (gameId: string, numPlayers: number, agents = ['greedy']): SimConfig => ({
  gameId,
  numPlayers,
  agents: Array.from({ length: numPlayers }, (_, i) => agents[i % agents.length]),
  seed: 3,
});

describe('significance tests', () => {
  it('normal CDF matches known values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it('two-proportion test', () => {
    expect(twoProportionP(50, 100, 50, 100)).toBe(1);
    expect(twoProportionP(300, 1000, 250, 1000)!).toBeLessThan(0.05); // 30% vs 25%
    expect(twoProportionP(30, 100, 25, 100)!).toBeGreaterThan(0.05); // same rates, too few games
    expect(twoProportionP(0, 0, 1, 10)).toBe(null);
  });

  it("Welch's test", () => {
    expect(welchP({ mean: 10, sd: 2, n: 500 }, { mean: 10.5, sd: 2, n: 500 })!).toBeLessThan(0.001);
    expect(welchP({ mean: 10, sd: 5, n: 50 }, { mean: 10.5, sd: 5, n: 50 })!).toBeGreaterThan(0.3);
  });
});

describe('progress statistics', () => {
  it('are recorded for games that define progress', () => {
    const g = entry('hearts').game;
    const cfg = config('hearts', 4);
    const records = runBatch(g, cfg, 0, 30);
    for (const r of records) {
      expect(r.leadChanges).toBeGreaterThanOrEqual(0);
      expect(r.halfwayLeader).toBeGreaterThanOrEqual(-1);
      expect(r.margin).toBeGreaterThan(0);
    }
    const s = computeStats(g, records, cfg);
    expect(s.comebacks!.rate).toBeGreaterThan(0);
    expect(s.comebacks!.rate).toBeLessThan(1);
    expect(s.leadChanges!.n).toBe(30);
  });

  it('are skipped for games without progress', () => {
    const g = loadGame(entry('crazy-eights').source.replace(/^progress:.*$/m, ''));
    const cfg = config('crazy-eights', 3);
    const s = computeStats(g, runBatch(g, cfg, 0, 20), cfg);
    expect(s.comebacks).toBeUndefined();
    expect(s.leadChanges).toBeUndefined();
    expect(s.margin).toBeDefined(); // margin only needs final scores
  });

  it('crazy eights margin is the best loser’s penalty, since the winner holds no cards', () => {
    const g = entry('crazy-eights').game;
    for (const r of runBatch(g, config('crazy-eights', 3), 0, 50)) {
      if (r.scores[r.winners[0]] === 0) expect(r.margin).toBe(Math.min(...r.scores.filter((_, i) => !r.winners.includes(i))));
    }
  });
});

describe('comparing two versions of a game', () => {
  const base = entry('crazy-eights');
  const cfg = config('crazy-eights', 3, ['greedy', 'random']);
  const run = (source: string) => {
    const g = loadGame(source);
    return computeStats(g, runBatch(g, cfg, 0, 1500), cfg);
  };

  it('finds no significant differences between identical versions', () => {
    const rows = compareSummaries(run(base.source), run(base.source));
    expect(rows.every((r) => r.p === null || r.p === 1)).toBe(true);
  });

  it("doesn't report luck as real when only the shuffles differ", () => {
    const g = loadGame(base.source);
    const summary = (seed: number) => computeStats(g, runBatch(g, { ...cfg, seed }, 0, 1500), { ...cfg, seed });
    const cards = compareSummaries(summary(1), summary(2)).filter((r) => r.group.startsWith('Cards'));
    expect(cards).toHaveLength(5);
    expect(cards.every((r) => r.p! >= SIGNIFICANCE)).toBe(true);
  });

  it('detects that dealing 7 cards makes games longer', () => {
    const variant = base.source.replace('count: "numPlayers == 2 ? 7 : 5"', 'count: 7');
    const rows = compareSummaries(run(base.source), run(variant));
    const turns = rows.find((r) => r.label === 'Average turns')!;
    expect(turns.b).toBeGreaterThan(turns.a);
    expect(turns.p!).toBeLessThan(SIGNIFICANCE);
    expect(comparisonCsv(rows, '5 cards', '7 cards')).toMatch(/^group,item,5 cards,7 cards,difference,p value\n/);
  });
});

describe('line diff', () => {
  it('finds changed, added and removed lines', () => {
    expect(diffLines('a\nb\nc', 'a\nb\nc')).toEqual([]);
    expect(diffLines('a\ncost: 4\nc', 'a\ncost: 5\nc')).toEqual([{ line: 2, removed: ['cost: 4'], added: ['cost: 5'] }]);
    expect(diffLines('a\nc', 'a\nb\nc')).toEqual([{ line: 2, removed: [], added: ['b'] }]);
    expect(diffLines('a\nb\nc\nd', 'a\nc')).toEqual([
      { line: 2, removed: ['b'], added: [] },
      { line: 4, removed: ['d'], added: [] },
    ]);
  });
});

describe('CSV export', () => {
  it('writes a summary and one row per game', () => {
    const g = entry('deck-builder').game;
    const cfg = config('deck-builder', 2, ['greedy', 'random']);
    const records = runBatch(g, cfg, 0, 5);
    const summary = summaryCsv(computeStats(g, records, cfg));
    expect(summary.split('\n')[0]).toBe('section,item,value');
    expect(summary).toMatch(/^win rate,Player 1 \(Casual\),/m);
    const perGame = recordsCsv(records, 2).trim().split('\n');
    expect(perGame).toHaveLength(6);
    expect(perGame[0]).toBe('game,winners,score player 1,score player 2,turns,actions,estimated minutes,lead changes,comeback,margin,hit move limit');
  });

  it('quotes cells containing commas or quotes', () => {
    const s = computeStats(entry('crazy-eights').game, [], config('crazy-eights', 2));
    expect(summaryCsv({ ...s, gameName: 'Crazy, "Eights"' })).toContain('run,game,"Crazy, ""Eights"""');
  });
});
