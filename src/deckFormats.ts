import { type CardRow, cardRows, CardListError, parseDelimited } from './cardList';
import { type AbilityBook, deckCsv, deckGame, EFFECTS, isDeckGame, type DeckEffect } from './deck';
import { BUILTIN_GAMES, type GameEntry, NOT_SNAP_RULES, RASCALLY_RACCOONS_RULES } from './games';
import { isRaccoonDeck, RACCOON_COLUMNS, raccoonDeckCsv, raccoonDeckGame, raccoonEffects } from './raccoonDeck';

/*
 * Each game on the site has fixed rules and takes uploaded decks in its own columns. This is what
 * the Simulate page needs to know about each one.
 */

export interface DeckFormat {
  /** The built-in game whose rules every deck is played with. */
  gameId: string;
  /** The template's header row, also used for pasted rows that have no header. */
  columns: string[];
  /** Excel template in public/templates/. */
  template: string;
  effects: DeckEffect[];
  /** The game's rules file, which every deck is played with. */
  rules: string;
  /** The rules' vars.shared values a sheet's Settings tab may change. */
  settings: string[];
  /** A read-only Google Sheet with this game's original deck, for people to copy. */
  exampleSheet: string;
  /** Checks the rows and builds the game they make with the game's rules (or `rules`, such as the rules with a sheet's settings). Throws DeckError. */
  deckGame(rows: CardRow[], deckName: string, rules?: string, book?: AbilityBook): GameEntry;
  /** Whether the game plays card text translated by Claude (the Ability column). */
  translatesText: boolean;
  /** A game of this kind (the built-in one or a deck) as CSV in the template's columns. */
  deckCsv(source: string): string;
  isDeck(id: string): boolean;
}

export const DECK_FORMATS: DeckFormat[] = [
  {
    gameId: 'not-snap',
    columns: ['Name', 'Per Player', 'Cost', 'Power', 'Ability'],
    template: 'deck-template.xlsx',
    effects: EFFECTS,
    rules: NOT_SNAP_RULES,
    settings: ['openingHand', 'turns', 'handLimit', 'drawPerTurn', 'cardsPerLocation', 'forgeBonus', 'bogPenalty'],
    exampleSheet: '18MKJkmbiJXNpaWK75qcFVc-S_7cUKb3oKUIr3plwUuQ',
    deckGame: (rows, name, rules = NOT_SNAP_RULES, book) => deckGame(rules, rows, name, book),
    translatesText: true,
    deckCsv,
    isDeck: isDeckGame,
  },
  {
    gameId: 'rascally-raccoons',
    columns: RACCOON_COLUMNS,
    template: 'rascally-raccoons-deck-template.xlsx',
    effects: raccoonEffects(RASCALLY_RACCOONS_RULES),
    rules: RASCALLY_RACCOONS_RULES,
    settings: ['endYourTurnSkipsDraw'],
    exampleSheet: '1ZEg5t5cTxueYxp50WYw0vDEU6uOupPD1n-r6cPwJ2NE',
    deckGame: (rows, name, rules = RASCALLY_RACCOONS_RULES) => raccoonDeckGame(rules, rows, name),
    translatesText: false,
    deckCsv: (source) => raccoonDeckCsv(RASCALLY_RACCOONS_RULES, source),
    isDeck: isRaccoonDeck,
  },
];

/** The kind of game a game id belongs to: a built-in game or one of its decks. */
export function formatOf(id: string): DeckFormat | undefined {
  return DECK_FORMATS.find((f) => f.gameId === id || f.isDeck(id));
}

/** The built-in game and uploaded decks of one kind of game. */
export function gamesOfKind(games: GameEntry[], gameId: string): GameEntry[] {
  return games.filter((g) => formatOf(g.game.id)?.gameId === gameId);
}

export const builtinGame = (gameId: string) => BUILTIN_GAMES.find((e) => e.game.id === gameId)!;

/**
 * Reads rows copied from a spreadsheet and pasted as text (tab-separated, or CSV). The first row is
 * the header when it names a card column (Name, Card Name …); otherwise the rows are read in the
 * template's column order.
 */
export function pastedCardRows(text: string, columns: string[]): CardRow[] {
  const table = parseDelimited(text.replace(/^\s*\n/, '')).filter((r) => r.some((c) => c.trim() !== ''));
  if (!table.length) throw new CardListError('Nothing was pasted');
  const known = new Set([...columns, 'Name', 'Card Name', 'Card'].map((c) => c.toLowerCase()));
  const hasHeader = table[0].some((c) => known.has(c.trim().toLowerCase()));
  return cardRows(hasHeader ? table : [columns, ...table]);
}
