import { isComeback, type GameRecord } from '../engine/simulate';
import type { Summary } from '../engine/stats';
import type { CompareRow } from './compare';

type Cell = string | number | boolean | null | undefined;

function toCsv(rows: Cell[][]): string {
  const cell = (v: Cell) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

const round = (x: number, digits = 4) => Number(x.toFixed(digits));

/** The report as rows of section, item, value; opens cleanly in a spreadsheet. */
export function summaryCsv(s: Summary): string {
  const rows: Cell[][] = [['section', 'item', 'value']];
  rows.push(['run', 'game', s.gameName], ['run', 'players', s.numPlayers], ['run', 'games', s.games], ['run', 'seed', s.seed]);
  s.seats.forEach((seat) => {
    const who = `Player ${seat.seat + 1} (${seat.agent})`;
    rows.push(
      ['win rate', who, round(seat.winRate)],
      ['win rate 95% low', who, round(seat.ci95[0])],
      ['win rate 95% high', who, round(seat.ci95[1])],
      ['average score', who, round(seat.avgScore, 2)],
    );
  });
  rows.push(['fairness', 'first player advantage', round(s.firstPlayerAdvantage)], ['fairness', 'no winner rate', round(s.noWinnerRate)]);
  if (s.comebacks) rows.push(['fun', 'comeback win rate', round(s.comebacks.rate)]);
  if (s.leadChanges) rows.push(['fun', 'average lead changes', round(s.leadChanges.mean, 2)]);
  if (s.margin) rows.push(['fun', 'average winning margin', round(s.margin.mean, 2)], ['fun', 'median winning margin', s.margin.median]);
  rows.push(
    ['length', 'average turns', round(s.turns.mean, 2)],
    ['length', 'median turns', s.turns.median],
    ['length', 'average estimated minutes', round(s.minutes.mean, 2)],
  );
  for (const c of s.cards) rows.push(['card played by winner', c.card, round(c.playedByWinner)], ['card plays per game', c.card, round(c.playsPerGame)]);
  return toCsv(rows);
}

/** One row per game. */
export function recordsCsv(records: Omit<GameRecord, 'cardPlays'>[], numPlayers: number): string {
  const seats = Array.from({ length: numPlayers }, (_, i) => `score player ${i + 1}`);
  const rows: Cell[][] = [['game', 'winners', ...seats, 'turns', 'actions', 'estimated minutes', 'lead changes', 'comeback', 'margin', 'hit move limit']];
  for (const r of records) {
    rows.push([
      r.index + 1,
      r.winners.map((w) => w + 1).join(' '),
      ...r.scores,
      r.turns,
      r.actions,
      round(r.estimatedSeconds / 60, 2),
      r.leadChanges,
      isComeback(r as GameRecord),
      r.margin,
      r.hitActionLimit,
    ]);
  }
  return toCsv(rows);
}

export function comparisonCsv(rows: CompareRow[], labelA: string, labelB: string): string {
  return toCsv([
    ['group', 'item', labelA, labelB, 'difference', 'p value'],
    ...rows.map((r) => [r.group, r.label, round(r.a), round(r.b), round(r.b - r.a), r.p === null ? '' : round(r.p)]),
  ]);
}
