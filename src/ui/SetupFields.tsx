import { AGENTS, getAgent } from '../engine/agents';
import type { SimConfig } from '../engine/simulate';
import type { AnyGame } from '../engine/types';
import type { GameEntry } from '../games';

export interface RunSetup {
  numPlayers: number;
  agents: string[];
  numGames: number;
  seed: number;
}

export const DEFAULT_SETUP: RunSetup = { numPlayers: 4, agents: ['greedy', 'greedy', 'greedy', 'greedy'], numGames: 1000, seed: 1 };

/** Adjusts the player count to what the game allows, keeping existing bot choices. */
export function fitSetup(setup: RunSetup, game: AnyGame, numPlayers = setup.numPlayers): RunSetup {
  const n = Math.min(game.maxPlayers, Math.max(game.minPlayers, numPlayers));
  return { ...setup, numPlayers: n, agents: Array.from({ length: n }, (_, i) => setup.agents[i] ?? setup.agents.at(-1) ?? 'greedy') };
}

/** Built-in games are bundled with the workers; other games travel to them as game.yaml text. */
export function configFor(entry: GameEntry, setup: RunSetup): SimConfig {
  return { gameId: entry.game.id, source: entry.builtin ? undefined : entry.source, numPlayers: setup.numPlayers, agents: setup.agents, seed: setup.seed };
}

/** "Casual ×4" or "Casual, Beginner ×3". */
export function describeAgents(agentIds: string[]): string {
  const labels = agentIds.map((a) => getAgent(a).label);
  const groups: { label: string; count: number }[] = [];
  for (const label of labels) {
    const last = groups.at(-1);
    if (last?.label === label) last.count++;
    else groups.push({ label, count: 1 });
  }
  return groups.map((g) => (g.count > 1 ? `${g.label} ×${g.count}` : g.label)).join(', ');
}

interface Props {
  games: GameEntry[];
  entry: GameEntry;
  onSelectGame(id: string): void;
  setup: RunSetup;
  onChange(setup: RunSetup): void;
  disabled: boolean;
  /** Pick among the decks of one game (the games list holds one game and its decks) instead of among games. */
  decks?: boolean;
}

export function SetupFields({ games, entry, onSelectGame, setup, onChange, disabled, decks }: Props) {
  const { game } = entry;
  return (
    <>
      <div className="form-grid">
        <label>
          {decks ? 'Deck' : 'Game'}
          <select value={game.id} onChange={(e) => onSelectGame(e.target.value)} disabled={disabled}>
            {games.map((g) => (
              <option key={g.game.id} value={g.game.id}>
                {decks ? (g.builtin ? 'Original deck' : g.game.name.replace(/^[^:]*:\s*/, '')) : g.game.name}
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
            value={setup.numPlayers}
            disabled={disabled}
            onChange={(e) => onChange(fitSetup(setup, game, Number(e.target.value) || game.minPlayers))}
          />
        </label>
        <label>
          Games to play
          <input
            type="number"
            min={1}
            max={1_000_000}
            step={100}
            value={setup.numGames}
            disabled={disabled}
            onChange={(e) => onChange({ ...setup, numGames: Math.max(1, Number(e.target.value) || 1) })}
          />
        </label>
        <label>
          Seed
          <input type="number" value={setup.seed} disabled={disabled} onChange={(e) => onChange({ ...setup, seed: Number(e.target.value) || 0 })} />
        </label>
      </div>
      <p className="muted small">
        {game.description} {game.minPlayers === game.maxPlayers ? `${game.minPlayers} players.` : `${game.minPlayers}-${game.maxPlayers} players.`}
      </p>

      <h3>How well each player plays</h3>
      <div className="seats">
        {setup.agents.map((agentId, seat) => (
          <label key={seat}>
            Player {seat + 1}
            <select
              value={agentId}
              disabled={disabled}
              onChange={(e) => onChange({ ...setup, agents: setup.agents.map((a, i) => (i === seat ? e.target.value : a)) })}
            >
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
    </>
  );
}

export function ProgressBar({ done, total }: { done: number; total: number }) {
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      <div className="progress-fill" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      <span>
        {done.toLocaleString()} / {total.toLocaleString()}
      </span>
    </div>
  );
}
