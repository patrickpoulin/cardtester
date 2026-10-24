import type { AnyGame } from '../engine/types';
import { crazyEights } from './crazyEights';

/** Built-in games. Uploaded games (Phase 3) will be added alongside these at runtime. */
export const GAMES: AnyGame[] = [crazyEights];

export function getGame(id: string): AnyGame {
  const game = GAMES.find((g) => g.id === id);
  if (!game) throw new Error(`Unknown game "${id}". Available: ${GAMES.map((g) => g.id).join(', ')}`);
  return game;
}
