import type { Summary } from '../engine/stats';
import { recordsCsv, summaryCsv } from '../report/csv';
import type { StoredRecord } from '../report/storage';
import { downloadFile } from './download';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const points = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)} pts`;

interface Props {
  summary: Summary;
  /** Per-game results, for the per-game spreadsheet download. */
  records?: StoredRecord[];
  elapsedSeconds?: number;
  title?: string;
  note?: string;
}

export function Results({ summary: s, records, elapsedSeconds, title = 'Results', note }: Props) {
  const maxWin = Math.max(...s.seats.map((seat) => seat.ci95[1]), 1 / s.numPlayers);
  const maxBin = Math.max(...s.turnHistogram.map((b) => b.count));
  const baseline = 1 / s.numPlayers;
  const fileBase = `${s.gameId}-${s.numPlayers}p-${s.games}games`;

  return (
    <section className="card">
      <div className="results-head">
        <h2>{title}</h2>
        <div className="actions tight">
          <button onClick={() => downloadFile(`${fileBase}-summary.csv`, summaryCsv(s))}>Summary (CSV)</button>
          {records && <button onClick={() => downloadFile(`${fileBase}-games.csv`, recordsCsv(records, s.numPlayers))}>Every game (CSV)</button>}
          <button onClick={() => downloadFile(`${fileBase}.json`, JSON.stringify(s, null, 2), 'application/json')}>JSON</button>
        </div>
      </div>
      {note && <p className="muted small">{note}</p>}
      <div className="tiles">
        <Tile label="Games played" value={s.games.toLocaleString()} note={elapsedSeconds === undefined ? `seed ${s.seed}` : `in ${elapsedSeconds.toFixed(1)}s`} />
        <Tile label="Average length" value={`${s.turns.mean.toFixed(1)} turns`} note={`median ${s.turns.median}`} />
        <Tile label="Estimated playtime" value={`${s.minutes.mean.toFixed(0)} min`} note={`10-90%: ${s.minutes.p10.toFixed(0)}-${s.minutes.p90.toFixed(0)} min`} />
        <Tile label="No winner" value={pct(s.noWinnerRate)} note="hit the move limit" />
      </div>

      <h3>Who wins</h3>
      <p className="muted small">The line marks an even share ({pct(baseline)}). Bars show the win rate; the shaded band is the 95% confidence range.</p>
      <div className="bars">
        {s.seats.map((seat) => (
          <div className="bar-row" key={seat.seat}>
            <span className="bar-label">
              Player {seat.seat + 1} <span className="muted">· {seat.agent}</span>
            </span>
            <div className="bar-track">
              <div className="bar-ci" style={{ left: `${(seat.ci95[0] / maxWin) * 100}%`, width: `${((seat.ci95[1] - seat.ci95[0]) / maxWin) * 100}%` }} />
              <div className="bar-fill" style={{ width: `${(seat.winRate / maxWin) * 100}%` }} />
              <div className="bar-baseline" style={{ left: `${(baseline / maxWin) * 100}%` }} />
            </div>
            <span className="bar-value">{pct(seat.winRate)}</span>
          </div>
        ))}
      </div>
      <p className="muted small">
        Average final score ({s.scoreLabel}): {s.seats.map((seat) => `P${seat.seat + 1} ${seat.avgScore.toFixed(1)}`).join(' · ')}
      </p>

      <h3>Fun and fairness</h3>
      <div className="tiles">
        <Tile
          label="First-player advantage"
          value={points(s.firstPlayerAdvantage)}
          note={`Player 1 wins ${pct(s.seats[0].winRate)} vs an even ${pct(baseline)}`}
        />
        {s.comebacks && <Tile label="Comeback wins" value={pct(s.comebacks.rate)} note="winner wasn't leading at halfway" />}
        {s.leadChanges && <Tile label="Lead changes" value={s.leadChanges.mean.toFixed(1)} note={`per game (median ${s.leadChanges.median})`} />}
        {s.margin && <Tile label="Winning margin" value={s.margin.mean.toFixed(1)} note={`points on average (median ${s.margin.median})`} />}
      </div>
      {!s.comebacks && (
        <p className="muted small">Add a progress rule to this game's file to measure comebacks and lead changes.</p>
      )}

      <h3>Game length</h3>
      <div className="histogram" aria-label="Turns per game">
        {s.turnHistogram.map((b) => (
          <div key={b.from} className="hist-col" title={`${b.from === b.to ? b.from : `${b.from}-${b.to}`} turns: ${b.count} games`}>
            <div className="hist-bar" style={{ height: `${(b.count / maxBin) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="hist-axis muted small">
        <span>{s.turns.min} turns</span>
        <span>{s.turns.max} turns</span>
      </div>

      <h3>Cards</h3>
      <p className="muted small">
        "Played by winner" is the share of a card's plays made by the player who went on to win. With {s.numPlayers} players, about {pct(baseline)} is
        normal; much higher suggests a strong card.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Card</th>
              <th>Plays per game</th>
              <th>Played by winner</th>
            </tr>
          </thead>
          <tbody>
            {s.cards.map((c) => (
              <tr key={c.card}>
                <td>{c.card}</td>
                <td>{c.playsPerGame.toFixed(2)}</td>
                <td className={c.playedByWinner > baseline * 1.25 ? 'hot' : c.playedByWinner < baseline * 0.75 ? 'cold' : ''}>{pct(c.playedByWinner)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="tile">
      <div className="muted small">{label}</div>
      <div className="tile-value">{value}</div>
      <div className="muted small">{note}</div>
    </div>
  );
}
