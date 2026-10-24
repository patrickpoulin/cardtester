import { SIGNIFICANCE, type CompareRow, type Format } from '../report/compare';
import { comparisonCsv } from '../report/csv';
import type { Change } from '../report/diff';
import { downloadFile, slug } from './download';

function format(value: number, f: Format): string {
  if (f === 'pct') return `${(value * 100).toFixed(1)}%`;
  if (f === 'minutes') return `${value.toFixed(1)} min`;
  return value.toFixed(2);
}

function formatChange(delta: number, f: Format): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
  const abs = Math.abs(delta);
  if (f === 'pct') return `${sign}${(abs * 100).toFixed(1)} pts`;
  if (f === 'minutes') return `${sign}${abs.toFixed(1)} min`;
  return `${sign}${abs.toFixed(2)}`;
}

interface Props {
  rows: CompareRow[];
  labelA: string;
  labelB: string;
  changes?: Change[];
  title?: string;
}

export function ComparisonView({ rows, labelA, labelB, changes, title = 'Comparison' }: Props) {
  const real = rows.filter((r) => r.p !== null && r.p < SIGNIFICANCE);
  let lastGroup = '';

  return (
    <section className="card">
      <div className="results-head">
        <h2>{title}</h2>
        <button onClick={() => downloadFile(`comparison-${slug(labelA)}-vs-${slug(labelB)}.csv`, comparisonCsv(rows, labelA, labelB))}>
          Download CSV
        </button>
      </div>
      <p>
        {real.length === 0
          ? 'None of the differences are clearly more than luck. Try more games, or a bigger change.'
          : `${real.length} of ${rows.length} differences are real: ${real.map((r) => r.label.toLowerCase()).join(', ')}.`}
      </p>
      {changes && changes.length > 0 && <ChangeList changes={changes} />}
      <div className="table-wrap full">
        <table>
          <thead>
            <tr>
              <th />
              <th>{labelA}</th>
              <th>{labelB}</th>
              <th>Change</th>
              <th>Real difference?</th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((r) => {
              const out = [];
              if (r.group !== lastGroup) {
                lastGroup = r.group;
                out.push(
                  <tr key={`g-${r.group}`} className="group-row">
                    <td colSpan={5}>{r.group}</td>
                  </tr>,
                );
              }
              const significant = r.p !== null && r.p < SIGNIFICANCE;
              out.push(
                <tr key={`${r.group}-${r.label}`}>
                  <td>{r.label}</td>
                  <td>{format(r.a, r.format)}</td>
                  <td>{format(r.b, r.format)}</td>
                  <td className={significant ? 'strong' : 'muted'}>{formatChange(r.b - r.a, r.format)}</td>
                  <td className={significant ? 'strong' : 'muted'}>{r.p === null ? '—' : significant ? 'Yes' : 'Could be luck'}</td>
                </tr>,
              );
              return out;
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        "Yes" means there's less than a {SIGNIFICANCE * 100}% chance a difference this big would appear by luck alone. With many rows, expect the
        occasional false "Yes"; rerun with a different seed to confirm a surprising result.
      </p>
    </section>
  );
}

export function ChangeList({ changes }: { changes: Change[] }) {
  return (
    <div className="changes">
      <div className="muted small">What changed in the rules file:</div>
      {changes.map((c, i) => (
        <pre key={i} className="change">
          <span className="muted">line {c.line}</span>
          {'\n'}
          {c.removed.map((l) => `− ${l}`).join('\n')}
          {c.removed.length > 0 && c.added.length > 0 ? '\n' : ''}
          {c.added.map((l) => `+ ${l}`).join('\n')}
        </pre>
      ))}
    </div>
  );
}
