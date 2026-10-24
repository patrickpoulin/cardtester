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
  /** Times the sole leader changed to a different player (needs `progress`). */
  leadChanges?: number;
  /** Seat that was alone in the lead halfway through the game, or -1 if the lead was shared (needs `progress`). */
  halfwayLeader?: number;
  /** Gap between the winner's final score and the best other score. */
  margin?: number;
}

export function isComeback(r: GameRecord): boolean | undefined {
  if (r.halfwayLeader === undefined || r.halfwayLeader < 0 || r.winners.length === 0) return undefined;
  return !r.winners.includes(r.halfwayLeader);
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
  // The sole leader at the start of each turn (-1 when tied), sampled when the game has `progress`.
  const leaders: number[] = [];
  const sampleLeader = () => {
    if (game.progress) leaders.push(soleLeader(game.progress(state)));
  };

  while (!game.isTerminal(state) && actions < maxActions) {
    const player = game.currentPlayer(state);
    if (player !== lastPlayer) {
      turns++;
      lastPlayer = player;
      sampleLeader();
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
  sampleLeader();

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
      ...(game.progress && { leadChanges: countLeadChanges(leaders), halfwayLeader: leaders[Math.floor(leaders.length / 2)] ?? -1 }),
      margin: winningMargin(result.winners, result.scores, game.scoreOrder ?? 'higher'),
    },
    log,
  };
}

function soleLeader(progress: number[]): number {
  const best = Math.max(...progress);
  const leaders = progress.flatMap((p, i) => (p === best ? [i] : []));
  return leaders.length === 1 ? leaders[0] : -1;
}

/** Counts changes of sole leader; a tie doesn't count as a change by itself. */
function countLeadChanges(leaders: number[]): number {
  let changes = 0;
  let last = -1;
  for (const l of leaders) {
    if (l < 0) continue;
    if (last >= 0 && l !== last) changes++;
    last = l;
  }
  return changes;
}

function winningMargin(winners: number[], scores: number[], order: 'higher' | 'lower'): number | undefined {
  const others = scores.filter((_, i) => !winners.includes(i));
  if (winners.length === 0 || others.length === 0) return undefined;
  const pick = order === 'higher' ? Math.max : Math.min;
  return Math.abs(pick(...winners.map((w) => scores[w])) - pick(...others));
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
