import { loadGame } from '../dsl/compile';
import type { SimConfig } from '../engine/simulate';
import type { AnyGame } from '../engine/types';
import crazyEights from './crazy-eights.yaml?raw';
import hearts from './hearts.yaml?raw';
import deckBuilder from './deck-builder.yaml?raw';

export interface GameEntry {
  game: AnyGame;
  /** The game.yaml text the game was compiled from. */
  source: string;
  builtin: boolean;
}

export const BUILTIN_GAMES: GameEntry[] = [crazyEights, hearts, deckBuilder].map((source) => ({
  game: loadGame(source),
  source,
  builtin: true,
}));

const compiled = new Map<string, AnyGame>();

/** Finds the game a run refers to: compiled from its `source` if given, otherwise a built-in game. */
export function resolveGame(config: SimConfig): AnyGame {
  if (config.source !== undefined) {
    let game = compiled.get(config.source);
    if (!game) {
      game = loadGame(config.source);
      compiled.set(config.source, game);
    }
    return game;
  }
  const entry = BUILTIN_GAMES.find((e) => e.game.id === config.gameId);
  if (!entry) throw new Error(`Unknown game "${config.gameId}". Available: ${BUILTIN_GAMES.map((e) => e.game.id).join(', ')}`);
  return entry.game;
}
