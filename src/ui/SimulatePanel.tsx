import { useState } from 'react';
import { playGame, validateConfig, type GameRecord } from '../engine/simulate';
import { computeStats, type Summary } from '../engine/stats';
import type { GameEntry } from '../games';
import { makeSavedRun, saveRun } from '../report/storage';
import { runInWorkers } from '../runner';
import { Results } from './Results';
import { DEFAULT_SETUP, ProgressBar, SetupFields, configFor, describeAgents, fitSetup, type RunSetup } from './SetupFields';

interface Props {
  games: GameEntry[];
  selectedId: string;
  onSelect(id: string): void;
  onSaved(): void;
}

export function SimulatePanel({ games, selectedId, onSelect, onSaved }: Props) {
  const [rawSetup, setSetup] = useState<RunSetup>(DEFAULT_SETUP);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ summary: Summary; records: GameRecord[]; elapsed: number } | null>(null);
  const [saveNote, setSaveNote] = useState('');
  const [trace, setTrace] = useState<string[] | null>(null);
  const [error, setError] = useState('');

  const entry = games.find((g) => g.game.id === selectedId) ?? games[0];
  // The game can also be selected from another page, so the player count is fitted to it here.
  const setup = fitSetup(rawSetup, entry.game);
  const game = entry.game;
  const config = configFor(entry, setup);

  function changeGame(id: string) {
    onSelect(id);
    setSetup(fitSetup(setup, games.find((g) => g.game.id === id)!.game));
    setResult(null);
    setTrace(null);
    setError('');
  }

  async function run() {
    setError('');
    setTrace(null);
    setSaveNote('');
    setProgress(0);
    setRunning(true);
    const started = performance.now();
    try {
      validateConfig(game, config);
      const records = await runInWorkers(config, setup.numGames, setProgress);
      const summary = computeStats(game, records, config);
      setResult({ summary, records, elapsed: (performance.now() - started) / 1000 });
      const label = `${game.name}, ${setup.numPlayers} players, ${describeAgents(setup.agents)}`;
      saveRun(makeSavedRun(label, config, summary, records))
        .then(() => {
          setSaveNote('Saved under Saved runs.');
          onSaved();
        })
        .catch(() => setSaveNote("This browser couldn't save the run; download it to keep it."));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  function watchOne() {
    setError('');
    try {
      validateConfig(game, config);
      setTrace(playGame(game, config, Math.floor(Math.random() * 1_000_000), true).log);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <section className="card">
        <h2>Set up the test</h2>
        <SetupFields games={games} entry={entry} onSelectGame={changeGame} setup={setup} onChange={setSetup} disabled={running} />
        <details className="source">
          <summary>View the rules file</summary>
          <pre>{entry.source}</pre>
        </details>
        <div className="actions">
          <button className="primary" onClick={run} disabled={running}>
            {running ? 'Running…' : `Run ${setup.numGames.toLocaleString()} games`}
          </button>
          <button onClick={watchOne} disabled={running}>
            Watch one game
          </button>
        </div>
        {running && <ProgressBar done={progress} total={setup.numGames} />}
        {error && <p className="error">{error}</p>}
      </section>

      {trace && (
        <section className="card">
          <h2>One sample game</h2>
          <ol className="trace">
            {trace.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        </section>
      )}

      {result && <Results summary={result.summary} records={result.records} elapsedSeconds={result.elapsed} note={saveNote} />}
    </>
  );
}
