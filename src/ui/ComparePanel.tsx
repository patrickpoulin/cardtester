import { useEffect, useState } from 'react';
import { formatOf } from '../deckFormats';
import { compareSummaries } from '../report/compare';
import { listRuns, type SavedRun } from '../report/storage';
import { ComparisonView } from './ComparisonView';

interface Props {
  /** Changes whenever a run is saved, so the list reloads. */
  version: number;
}

const when = (at: string | number) => new Date(at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' });
const runLabel = (r: SavedRun) => `${when(r.createdAt)}: ${r.label} (${r.summary.games.toLocaleString()} games)`;

/** Compares two saved runs, such as the same deck before and after a change to the sheet. */
export function ComparePanel({ version }: Props) {
  const [runs, setRuns] = useState<SavedRun[] | null>(null);
  const [error, setError] = useState('');
  const [a, setA] = useState<number | ''>('');
  const [b, setB] = useState<number | ''>('');
  const [shown, setShown] = useState<[number, number] | null>(null);

  useEffect(() => {
    listRuns()
      .then((r) => {
        setRuns(r);
        setError('');
      })
      .catch(() => setError("This browser can't store saved runs (private window or blocked site data)."));
  }, [version]);

  const byId = (id: number | '') => runs?.find((r) => r.id === id);
  const runA = shown && byId(shown[0]);
  const runB = shown && byId(shown[1]);
  const different = runA && runB && (runA.summary.numPlayers !== runB.summary.numPlayers || formatOf(runA.summary.gameId)?.gameId !== formatOf(runB.summary.gameId)?.gameId);

  const picker = (label: string, value: number | '', set: (v: number | '') => void) => (
    <label className="stack">
      {label}
      <select value={value} onChange={(e) => set(e.target.value === '' ? '' : Number(e.target.value))}>
        <option value="">Choose a saved run…</option>
        {runs?.map((r) => (
          <option key={r.id} value={r.id}>
            {runLabel(r)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <section className="card">
        <h2>Compare two runs</h2>
        <p className="muted">
          Pick two runs from Saved runs, for example a deck before and after you changed it in the sheet. The comparison shows what changed and
          which differences are bigger than luck would explain. Runs with the same seed and number of games compare most fairly.
        </p>
        {error && <p className="error">{error}</p>}
        {runs && runs.length < 2 && <p className="muted">Save at least two runs on the Simulate page first; every run is saved automatically.</p>}
        {runs && runs.length >= 2 && (
          <>
            {picker('Run A (before)', a, setA)}
            {picker('Run B (after)', b, setB)}
            <div className="actions">
              <button className="primary" disabled={a === '' || b === '' || a === b} onClick={() => setShown([a as number, b as number])}>
                Compare
              </button>
            </div>
          </>
        )}
        {different && <p className="muted small">These runs are from different games or player counts, so some rows may not mean much.</p>}
      </section>
      {runA && runB && (
        <ComparisonView title="Comparison" rows={compareSummaries(runA.summary, runB.summary)} labelA={runA.label} labelB={runB.label} />
      )}
    </>
  );
}
