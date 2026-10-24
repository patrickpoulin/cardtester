import { getAgent } from './agents';
import type { GameRecord, SimConfig } from './simulate';
import { getGame } from '../games';

export interface Distribution {
  mean: number;
  median: number;
  p10: number;
  p90: number;
  min: number;
  max: number;
}

export interface SeatStats {
  seat: number;
  agent: string;
  /** Shared wins count fractionally (two winners = half a win each). */
  wins: number;
  winRate: number;
  ci95: [number, number];
  avgScore: number;
}

export interface CardStats {
  card: string;
  plays: number;
  playsPerGame: number;
  /** Fraction of this card's plays made by the eventual winner. Compare with 1 / numPlayers. */
  playedByWinner: number;
}

export interface Summary {
  gameId: string;
  gameName: string;
  numPlayers: number;
  games: number;
  scoreLabel: string;
  seats: SeatStats[];
  /** Games that ended with no winner (hit the action cap). */
  noWinnerRate: number;
  turns: Distribution;
  turnHistogram: { from: number; to: number; count: number }[];
  actionsPerGame: number;
  minutes: Distribution;
  cards: CardStats[];
}

export function computeStats(records: GameRecord[], config: SimConfig): Summary {
  const game = getGame(config.gameId);
  const n = records.length;
  const seats: SeatStats[] = config.agents.map((agentId, seat) => {
    let wins = 0;
    let scoreSum = 0;
    for (const r of records) {
      if (r.winners.includes(seat)) wins += 1 / r.winners.length;
      scoreSum += r.scores[seat];
    }
    return {
      seat,
      agent: getAgent(agentId).label,
      wins,
      winRate: n ? wins / n : 0,
      ci95: wilson(wins, n),
      avgScore: n ? scoreSum / n : 0,
    };
  });

  const turns = records.map((r) => r.turns);
  const cardTotals = new Map<string, { plays: number; byWinner: number }>();
  for (const r of records) {
    for (const [card, perSeat] of Object.entries(r.cardPlays)) {
      const t = cardTotals.get(card) ?? { plays: 0, byWinner: 0 };
      perSeat.forEach((count, seat) => {
        t.plays += count;
        if (r.winners.includes(seat)) t.byWinner += count / r.winners.length;
      });
      cardTotals.set(card, t);
    }
  }
  const cards = [...cardTotals.entries()]
    .map(([card, t]) => ({
      card,
      plays: t.plays,
      playsPerGame: n ? t.plays / n : 0,
      playedByWinner: t.plays ? t.byWinner / t.plays : 0,
    }))
    .sort((a, b) => b.playedByWinner - a.playedByWinner);

  return {
    gameId: game.id,
    gameName: game.name,
    numPlayers: config.numPlayers,
    games: n,
    scoreLabel: game.scoreLabel,
    seats,
    noWinnerRate: n ? records.filter((r) => r.winners.length === 0).length / n : 0,
    turns: distribution(turns),
    turnHistogram: histogram(turns),
    actionsPerGame: mean(records.map((r) => r.actions)),
    minutes: distribution(records.map((r) => r.estimatedSeconds / 60)),
    cards,
  };
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function distribution(values: number[]): Distribution {
  if (!values.length) return { mean: 0, median: 0, p10: 0, p90: 0, min: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    mean: mean(values),
    median: q(0.5),
    p10: q(0.1),
    p90: q(0.9),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function histogram(values: number[], maxBins = 20): Summary['turnHistogram'] {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = Math.max(1, Math.ceil((max - min + 1) / maxBins));
  const bins = Array.from({ length: Math.ceil((max - min + 1) / width) }, (_, i) => ({
    from: min + i * width,
    to: min + (i + 1) * width - 1,
    count: 0,
  }));
  for (const v of values) bins[Math.floor((v - min) / width)].count++;
  return bins;
}

/** Wilson score interval: a 95% confidence range for a win rate. */
export function wilson(successes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}
