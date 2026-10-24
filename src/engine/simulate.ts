import { getAgent } from './agents';
import { Rng, gameSeed } from './rng';
import type { AnyGame } from './types';

export interface SimConfig {
  gameId: string;
  /** game.yaml text for games that aren't built in; workers compile it themselves. */
  source?: string;
  numPlayers: number;
  /** Agent id per seat, e.g. ['greedy', 'random', 'random', 'random']. */
  agents: string[];
  seed: number;
  /** Safety cap so a broken rule set can't loop forever. */
  maxActions?: number;
}

export interface GameRecord {
  index: number;
  winners: number[];
  scores: number[];
  /** A turn is a run of consecutive actions by the same player. */
  turns: number;
  actions: number;
  estimatedSeconds: number;
  hitActionLimit: boolean;
  /** Card name -> how many times each seat played it. */
  cardPlays: Record<string, number[]>;
}

const DEFAULT_MAX_ACTIONS = 10_000;

export function validateConfig(game: AnyGame, config: SimConfig): void {
  if (config.numPlayers < game.minPlayers || config.numPlayers > game.maxPlayers) {
    throw new Error(`${game.name} needs ${game.minPlayers}-${game.maxPlayers} players, got ${config.numPlayers}`);
  }
  if (config.agents.length !== config.numPlayers) {
    throw new Error(`Expected ${config.numPlayers} agents, got ${config.agents.length}`);
  }
  config.agents.forEach(getAgent);
}

/** Plays game number `index` of a run. With `trace`, also returns a readable move-by-move log. */
export function playGame(game: AnyGame, config: SimConfig, index: number, trace = false): { record: GameRecord; log: string[] } {
  const agents = config.agents.map(getAgent);
  const rng = new Rng(gameSeed(config.seed, index));
  const state = game.setup(config.numPlayers, rng);
  const maxActions = config.maxActions ?? DEFAULT_MAX_ACTIONS;

  const log: string[] = [];
  const cardPlays: Record<string, number[]> = {};
  let actions = 0;
  let turns = 0;
  let lastPlayer = -1;
  let seconds = game.timing.setupSeconds;

  while (!game.isTerminal(state) && actions < maxActions) {
    const player = game.currentPlayer(state);
    if (player !== lastPlayer) {
      turns++;
      lastPlayer = player;
    }
    const legal = game.legalActions(state);
    if (legal.length === 0) throw new Error(`${game.name}: player ${player + 1} has no legal moves (game ${index})`);
    const action = agents[player].choose(game, state, legal, rng);

    if (trace) log.push(`Turn ${turns} · Player ${player + 1}: ${game.describeAction(state, action)}`);
    if (action.card !== undefined) {
      (cardPlays[action.card] ??= new Array(config.numPlayers).fill(0))[player]++;
    }
    seconds += game.timing.actionSeconds(action);
    game.applyAction(state, action, rng);
    actions++;
  }

  const hitActionLimit = !game.isTerminal(state);
  const result = hitActionLimit
    ? { winners: [], scores: new Array(config.numPlayers).fill(0) }
    : game.result(state);

  if (trace) {
    log.push(
      hitActionLimit
        ? `Stopped after ${maxActions} actions with no winner.`
        : `Game over. Winner: ${result.winners.map((w) => `Player ${w + 1}`).join(', ') || 'nobody'}. ` +
            `${game.scoreLabel}: ${result.scores.join(' / ')}`,
    );
  }

  return {
    record: {
      index,
      winners: result.winners,
      scores: result.scores,
      turns,
      actions,
      estimatedSeconds: seconds,
      hitActionLimit,
      cardPlays,
    },
    log,
  };
}

/** Plays games start..start+count-1. Used by both the browser workers and the CLI. */
export function runBatch(
  game: AnyGame,
  config: SimConfig,
  start: number,
  count: number,
  onProgress?: (done: number) => void,
): GameRecord[] {
  validateConfig(game, config);
  const records: GameRecord[] = [];
  for (let i = 0; i < count; i++) {
    records.push(playGame(game, config, start + i).record);
    if (onProgress && ((i + 1) % 50 === 0 || i + 1 === count)) onProgress(i + 1);
  }
  return records;
}
