import type { Distribution, Rate, Summary } from '../engine/stats';

export type Format = 'pct' | 'num' | 'minutes';

export interface CompareRow {
  group: string;
  label: string;
  a: number;
  b: number;
  format: Format;
  /**
   * Two-sided p-value: the chance of a difference at least this big if the two versions were
   * really the same. Null when there isn't enough data to say.
   */
  p: number | null;
}

/** Below this p-value a difference is reported as real rather than luck. */
export const SIGNIFICANCE = 0.05;

/** Lines up the statistics of two runs and tests each difference. */
export function compareSummaries(a: Summary, b: Summary): CompareRow[] {
  const rows: CompareRow[] = [];
  const seats = Math.min(a.seats.length, b.seats.length);
  for (let i = 0; i < seats; i++) {
    const [sa, sb] = [a.seats[i], b.seats[i]];
    rows.push({ group: 'Who wins', label: `Player ${i + 1} win rate`, a: sa.winRate, b: sb.winRate, format: 'pct', p: twoProportionP(sa.wins, a.games, sb.wins, b.games) });
  }
  rows.push(rateRow('Who wins', 'No winner', { count: a.noWinnerRate * a.games, n: a.games }, { count: b.noWinnerRate * b.games, n: b.games }));

  rows.push(meanRow('Game length', 'Average turns', a.turns, b.turns, 'num'));
  rows.push(meanRow('Game length', 'Estimated playtime', a.minutes, b.minutes, 'minutes'));

  if (a.comebacks && b.comebacks) rows.push(rateRow('Fun and fairness', 'Comeback wins', a.comebacks, b.comebacks));
  if (a.leadChanges && b.leadChanges) rows.push(meanRow('Fun and fairness', 'Lead changes per game', a.leadChanges, b.leadChanges, 'num'));
  if (a.margin && b.margin) rows.push(meanRow('Fun and fairness', 'Average winning margin', a.margin, b.margin, 'num'));

  // The cards whose "played by winner" share moved most. Picking the biggest movers out of many
  // cards would make luck look real, so each p-value is multiplied by the number of cards
  // considered (Bonferroni correction).
  const bCards = new Map(b.cards.map((c) => [c.card, c]));
  const candidates = a.cards.flatMap((ca) => {
    const cb = bCards.get(ca.card);
    return cb && ca.plays > 0 && cb.plays > 0 ? [{ ca, cb }] : [];
  });
  const cardRows = candidates
    .map(({ ca, cb }) => {
      const p = twoProportionP(ca.playedByWinner * ca.plays, ca.plays, cb.playedByWinner * cb.plays, cb.plays);
      return {
        group: 'Cards played by the winner (biggest changes)',
        label: ca.card,
        a: ca.playedByWinner,
        b: cb.playedByWinner,
        format: 'pct' as const,
        p: p === null ? null : Math.min(1, p * candidates.length),
      };
    })
    .sort((x, y) => Math.abs(y.b - y.a) - Math.abs(x.b - x.a))
    .slice(0, 5);
  rows.push(...cardRows);
  return rows;
}

function rateRow(group: string, label: string, a: Pick<Rate, 'count' | 'n'>, b: Pick<Rate, 'count' | 'n'>): CompareRow {
  return { group, label, a: a.n ? a.count / a.n : 0, b: b.n ? b.count / b.n : 0, format: 'pct', p: twoProportionP(a.count, a.n, b.count, b.n) };
}

function meanRow(group: string, label: string, a: Distribution, b: Distribution, format: Format): CompareRow {
  return { group, label, a: a.mean, b: b.mean, format, p: welchP(a, b) };
}

/** Two-proportion z-test. */
export function twoProportionP(x1: number, n1: number, x2: number, n2: number): number | null {
  if (n1 < 1 || n2 < 1) return null;
  const pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return 1;
  return twoSided((x1 / n1 - x2 / n2) / se);
}

/** Welch's test on two means, using the normal approximation (runs have hundreds of games). */
export function welchP(a: Pick<Distribution, 'mean' | 'sd' | 'n'>, b: Pick<Distribution, 'mean' | 'sd' | 'n'>): number | null {
  if (a.n < 2 || b.n < 2) return null;
  const se = Math.sqrt((a.sd * a.sd) / a.n + (b.sd * b.sd) / b.n);
  if (se === 0) return a.mean === b.mean ? 1 : 0;
  return twoSided((a.mean - b.mean) / se);
}

function twoSided(z: number): number {
  if (z === 0) return 1;
  return Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, accurate to about 1e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}
