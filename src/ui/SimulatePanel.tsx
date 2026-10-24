import { useState } from 'react';
import { AGENTS } from '../engine/agents';
import { playGame, validateConfig, type SimConfig } from '../engine/simulate';
import { computeStats, type Summary } from '../engine/stats';
import type { GameEntry } from '../games';
import { runInWorkers } from '../runner';
import { Results } from './Results';

interface Props {
  games: GameEntry[];
  selectedId: string;
  onSelect(id: string): void;
}

export function SimulatePanel({ games, selectedId, onSelect }: Props) {
  const [numPlayers, setNumPlayers] = useState(4);
  const [agents, setAgents] = useState<string[]>(['greedy', 'greedy', 'greedy', 'greedy']);
  const [numGames, setNumGames] = useState(1000);
  const [seed, setSeed] = useState(1);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [trace, setTrace] = useState<string[] | null>(null);
  const [error, setError] = useState('');

  const entry = games.find((g) => g.game.id === selectedId) ?? games[0];
  const game = entry.game;
  // Built-in games are bundled with the workers; other games travel to them as game.yaml text.
  const config: SimConfig = { gameId: game.id, source: entry.builtin ? undefined : entry.source, numPlayers, agents, seed };

  function changePlayers(n: number) {
    setNumPlayers(n);
    setAgents((prev) => Array.from({ length: n }, (_, i) => prev[i] ?? prev[prev.length - 1] ?? 'greedy'));
  }

  function changeGame(id: string) {
    const next = games.find((g) => g.game.id === id)!.game;
    onSelect(id);
    changePlayers(Math.min(next.maxPlayers, Math.max(next.minPlayers, numPlayers)));
    setSummary(null);
    setTrace(null);
    setError('');
  }

  async function run() {
    setError('');
    setTrace(null);
    setProgress(0);
    setRunning(true);
    const started = performance.now();
    try {
      validateConfig(game, config);
      const records = await runInWorkers(config, numGames, setProgress);
      setSummary(computeStats(game, records, config));
      setElapsed((performance.now() - started) / 1000);
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
        <div className="form-grid">
          <label>
            Game
            <select value={game.id} onChange={(e) => changeGame(e.target.value)} disabled={running}>
              {games.map((g) => (
                <option key={g.game.id} value={g.game.id}>
                  {g.game.name}
                  {g.builtin ? '' : ' (yours)'}
                </option>
              ))}
            </select>
          </label>
          <label>
            Players
            <input
              type="number"
              min={game.minPlayers}
              max={game.maxPlayers}
              value={numPlayers}
              disabled={running}
              onChange={(e) => changePlayers(Math.min(game.maxPlayers, Math.max(game.minPlayers, Number(e.target.value) || game.minPlayers)))}
            />
          </label>
          <label>
            Games to play
            <input type="number" min={1} max={1_000_000} step={100} value={numGames} disabled={running} onChange={(e) => setNumGames(Math.max(1, Number(e.target.value) || 1))} />
          </label>
          <label>
            Seed
            <input type="number" value={seed} disabled={running} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
          </label>
        </div>
        <p className="muted small">
          {game.description} {game.minPlayers === game.maxPlayers ? `${game.minPlayers} players.` : `${game.minPlayers}-${game.maxPlayers} players.`}
        </p>
        <details className="source">
          <summary>View the rules file</summary>
          <pre>{entry.source}</pre>
        </details>

        <h3>How well each player plays</h3>
        <div className="seats">
          {agents.map((agentId, seat) => (
            <label key={seat}>
              Player {seat + 1}
              <select value={agentId} disabled={running} onChange={(e) => setAgents(agents.map((a, i) => (i === seat ? e.target.value : a)))}>
                {AGENTS.map((a) => (
                  <option key={a.id} value={a.id} title={a.description}>
                    {a.label}
                  </option>
                ))}
                <option disabled>Expert (coming soon)</option>
              </select>
            </label>
          ))}
        </div>

        <div className="actions">
          <button className="primary" onClick={run} disabled={running}>
            {running ? 'Running…' : `Run ${numGames.toLocaleString()} games`}
          </button>
          <button onClick={watchOne} disabled={running}>
            Watch one game
          </button>
        </div>
        {running && (
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={numGames} aria-valuenow={progress}>
            <div className="progress-fill" style={{ width: `${(progress / numGames) * 100}%` }} />
            <span>
              {progress.toLocaleString()} / {numGames.toLocaleString()}
            </span>
          </div>
        )}
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

      {summary && <Results summary={summary} elapsedSeconds={elapsed} />}
    </>
  );
}
