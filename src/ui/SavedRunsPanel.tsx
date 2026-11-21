import { useEffect, useState } from 'react';
import { deleteRun, listRuns, type SavedRun } from '../report/storage';
import { Results } from './Results';

interface Props {
  /** Changes whenever a run is saved elsewhere, so the list reloads. */
  version: number;
}

export function SavedRunsPanel({ version }: Props) {
  const [runs, setRuns] = useState<SavedRun[] | null>(null);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState<number | null>(null);
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

  async function remove(id: number) {
    await deleteRun(id).catch(() => {});
    if (viewing === id) setViewing(null);
    setReload((n) => n + 1);
  }

  const viewed = viewing === null ? undefined : byId(viewing);

  return (
    <>
      <section className="card">
        <h2>Saved runs</h2>
        <p className="muted">Every run is saved in this browser. Compare any two on the Compare page.</p>
        {error && <p className="error">{error}</p>}
        {runs && runs.length === 0 && <p className="muted">No saved runs yet. Run a simulation and it will appear here.</p>}
        {runs && runs.length > 0 && (
          <>
            <div className="table-wrap tall">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Run</th>
                    <th>Games</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className={viewing === r.id ? 'selected' : ''}>
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
          </>
        )}
      </section>
      {viewed && <Results title={viewed.label} summary={viewed.summary} records={viewed.records} />}
    </>
  );
}
