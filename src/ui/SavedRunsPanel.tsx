import { useEffect, useState } from 'react';
import { compareSummaries } from '../report/compare';
import { deleteRun, listRuns, type SavedRun } from '../report/storage';
import { ComparisonView } from './ComparisonView';
import { Results } from './Results';

interface Props {
  /** Changes whenever a run is saved elsewhere, so the list reloads. */
  version: number;
}

export function SavedRunsPanel({ version }: Props) {
  const [runs, setRuns] = useState<SavedRun[] | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [viewing, setViewing] = useState<number | null>(null);
  const [comparing, setComparing] = useState<[number, number] | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    listRuns()
      .then((r) => {
        setRuns(r);
        setError('');
      })
      .catch(() => setError("This browser can't store saved runs (private window or blocked site data)."));
  }, [version, reload]);

  const byId = (id: number) => runs?.find((r) => r.id === id);

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev.slice(-1), id]));
  }

  async function remove(id: number) {
    await deleteRun(id).catch(() => {});
    setSelected((prev) => prev.filter((x) => x !== id));
    if (viewing === id) setViewing(null);
    if (comparing?.includes(id)) setComparing(null);
    setReload((n) => n + 1);
  }

  const viewed = viewing === null ? undefined : byId(viewing);
  const compared = comparing && ([byId(comparing[0]), byId(comparing[1])] as const);

  return (
    <>
      <section className="card">
        <h2>Saved runs</h2>
        <p className="muted">Every run is saved in this browser. Tick two runs to compare them.</p>
        {error && <p className="error">{error}</p>}
        {runs && runs.length === 0 && <p className="muted">No saved runs yet. Run a simulation and it will appear here.</p>}
        {runs && runs.length > 0 && (
          <>
            <div className="table-wrap tall">
              <table>
                <thead>
                  <tr>
                    <th aria-label="Select" />
                    <th>When</th>
                    <th>Run</th>
                    <th>Games</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className={viewing === r.id ? 'selected' : ''}>
                      <td>
                        <input type="checkbox" aria-label={`Select ${r.label}`} checked={selected.includes(r.id!)} onChange={() => toggle(r.id!)} />
                      </td>
                      <td className="nowrap">{new Date(r.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td>{r.label}</td>
                      <td>{r.summary.games.toLocaleString()}</td>
                      <td className="nowrap">
                        <button className="link" onClick={() => setViewing(viewing === r.id ? null : r.id!)}>
                          {viewing === r.id ? 'Hide' : 'View'}
                        </button>
                        <button className="link danger" onClick={() => remove(r.id!)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="actions">
              <button className="primary" disabled={selected.length !== 2} onClick={() => setComparing([selected[0], selected[1]])}>
                Compare selected runs
              </button>
            </div>
          </>
        )}
      </section>

      {compared && compared[0] && compared[1] && (
        <ComparisonView
          title="Comparing saved runs"
          rows={compareSummaries(compared[0].summary, compared[1].summary)}
          labelA={compared[0].label}
          labelB={compared[1].label}
        />
      )}
      {viewed && <Results title={viewed.label} summary={viewed.summary} records={viewed.records} />}
    </>
  );
}
