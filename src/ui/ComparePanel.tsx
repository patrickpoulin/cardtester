import { useMemo, useState } from 'react';
import { GameDefinitionError, loadGame } from '../dsl/compile';
import { smokeTest } from '../dsl/smoke';
import { validateConfig, type SimConfig } from '../engine/simulate';
import { computeStats } from '../engine/stats';
import type { GameEntry } from '../games';
import { compareSummaries, type CompareRow } from '../report/compare';
import { diffLines, type Change } from '../report/diff';
import { makeSavedRun, saveRun } from '../report/storage';
import { runInWorkers } from '../runner';
import { ChangeList, ComparisonView } from './ComparisonView';
import { DEFAULT_SETUP, ProgressBar, SetupFields, configFor, describeAgents, fitSetup, type RunSetup } from './SetupFields';

interface Props {
  games: GameEntry[];
  selectedId: string;
  onSelect(id: string): void;
  onSaved(): void;
}

export function ComparePanel({ games, selectedId, onSelect, onSaved }: Props) {
  const entry = games.find((g) => g.game.id === selectedId) ?? games[0];
  const [setup, setSetup] = useState<RunSetup>(DEFAULT_SETUP);
  const [variant, setVariant] = useState(entry.source);
  const [variantOf, setVariantOf] = useState(entry.game.id);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [issues, setIssues] = useState<string[]>([]);
  const [result, setResult] = useState<{ rows: CompareRow[]; changes: Change[] } | null>(null);

  // Start the variant from the selected game's file whenever the game changes.
  if (variantOf !== entry.game.id) {
    setVariantOf(entry.game.id);
    setVariant(entry.source);
    setResult(null);
  }

  const changes = useMemo(() => diffLines(entry.source, variant), [entry.source, variant]);

  function changeGame(id: string) {
    onSelect(id);
    setSetup(fitSetup(setup, games.find((g) => g.game.id === id)!.game));
  }

  async function run() {
    setIssues([]);
    setResult(null);
    let variantGame;
    try {
      variantGame = loadGame(variant);
    } catch (err) {
      setIssues(err instanceof GameDefinitionError ? err.issues : [err instanceof Error ? err.message : String(err)]);
      return;
    }
    const problems = smokeTest(variantGame);
    if (problems.length) return setIssues(problems);

    const configA = configFor(entry, setup);
    const configB: SimConfig = { ...configA, gameId: variantGame.id, source: variant };
    try {
      validateConfig(entry.game, configA);
      validateConfig(variantGame, configB);
    } catch (err) {
      return setIssues([err instanceof Error ? err.message : String(err)]);
    }

    const n = setup.numGames;
    setProgress(0);
    setRunning(true);
    try {
      // Both versions use the same seed, so each game starts from the same shuffle.
      const recordsA = await runInWorkers(configA, n, setProgress);
      const recordsB = await runInWorkers(configB, n, (done) => setProgress(n + done));
      const summaryA = computeStats(entry.game, recordsA, configA);
      const summaryB = computeStats(variantGame, recordsB, configB);
      setResult({ rows: compareSummaries(summaryA, summaryB), changes });

      const who = `${setup.numPlayers} players, ${describeAgents(setup.agents)}`;
      const firstChange = (changes[0]?.added[0] ?? '').trim().replace(/^-\s*/, '').slice(0, 60) || 'lines removed';
      Promise.all([
        saveRun(makeSavedRun(`${entry.game.name} (original), ${who}`, configA, summaryA, recordsA)),
        saveRun(makeSavedRun(`${variantGame.name} (changed: ${firstChange}), ${who}`, configB, summaryB, recordsB)),
      ])
        .then(onSaved)
        .catch(() => {});
    } catch (err) {
      setIssues([err instanceof Error ? err.message : String(err)]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <section className="card">
        <h2>Compare two versions</h2>
        <p className="muted">
          Change something in the game's rules file (a card's cost, the hand size, a scoring rule) and see whether it really makes a
          difference. Both versions play the same number of games with the same shuffles.
        </p>
        <SetupFields games={games} entry={entry} onSelectGame={changeGame} setup={setup} onChange={setSetup} disabled={running} />

        <h3>Your changed version</h3>
        <label className="stack">
          Edit the rules file below
          <textarea className="code" rows={16} spellCheck={false} value={variant} disabled={running} onChange={(e) => setVariant(e.target.value)} />
        </label>
        {changes.length > 0 ? (
          <ChangeList changes={changes} />
        ) : (
          <p className="muted small">No changes yet. For example, change a card's cost or the number of cards dealt.</p>
        )}
        <div className="actions">
          <button className="primary" onClick={run} disabled={running || changes.length === 0}>
            {running ? 'Running…' : `Compare (${(setup.numGames * 2).toLocaleString()} games)`}
          </button>
          <button onClick={() => setVariant(entry.source)} disabled={running || changes.length === 0}>
            Undo my changes
          </button>
        </div>
        {running && <ProgressBar done={progress} total={setup.numGames * 2} />}
        {issues.length > 0 && (
          <div className="error">
            <p>The changed version has {issues.length === 1 ? 'a problem' : `${issues.length} problems`}:</p>
            <ul className="issues">
              {issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {result && <ComparisonView rows={result.rows} labelA="Original" labelB="Changed" changes={result.changes} />}
    </>
  );
}
