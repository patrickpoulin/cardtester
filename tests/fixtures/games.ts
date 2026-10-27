import { loadGame } from '../../src/dsl/compile';
import { BUILTIN_GAMES, type GameEntry } from '../../src/games';
import crazyEights from './games/crazy-eights.yaml?raw';
import deckBuilder from './games/deck-builder.yaml?raw';
import hearts from './games/hearts.yaml?raw';

/** The site's game plus the classic games the engine was built and tested against. */
export const TEST_GAMES: GameEntry[] = [
  ...BUILTIN_GAMES,
  ...[crazyEights, hearts, deckBuilder].map((source) => ({ game: loadGame(source), source, builtin: true })),
];
