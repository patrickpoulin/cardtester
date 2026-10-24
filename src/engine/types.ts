import type { Rng } from './rng';

/** A move a player can make. `card` names the card involved, if any, so card statistics work for every game. */
export interface Action {
  type: string;
  card?: string;
}

export interface GameResult {
  /** Seats that won. Empty means nobody won (e.g. the game was cut off). Several entries mean a shared win. */
  winners: number[];
  /** Final score per seat; what it means is described by `GameDefinition.scoreLabel`. */
  scores: number[];
}

/**
 * Everything the simulator needs to play a game. Hand-written games implement this
 * directly; later the game.yaml interpreter will produce one of these from a definition file.
 *
 * `applyAction` mutates the state in place, which keeps simulation fast.
 */
export interface GameDefinition<S = unknown, A extends Action = Action> {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  scoreLabel: string;
  /** Rough real-world seconds, used to turn simulated actions into an estimated playtime. */
  timing: {
    setupSeconds: number;
    actionSeconds(action: A): number;
  };
  setup(numPlayers: number, rng: Rng): S;
  currentPlayer(state: S): number;
  legalActions(state: S): A[];
  applyAction(state: S, action: A, rng: Rng): void;
  isTerminal(state: S): boolean;
  result(state: S): GameResult;
  describeAction(state: S, action: A): string;
  /** Optional move rating (higher is better) used by the greedy agent. */
  heuristic?(state: S, action: A): number;
}

export type AnyGame = GameDefinition<any, Action>;
