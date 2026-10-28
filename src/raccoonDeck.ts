import { isMap, isSeq, parseDocument } from 'yaml';
import { type CardRow, mergeCardList } from './cardList';
import { DeckError, type DeckEffect } from './deck';
import { loadGame, parseGameYaml } from './dsl/compile';
import type { GameEntry } from './games';

/*
 * A deck for Rascally Raccoons: one row per card with how many copies go in the shared deck. Every
 * card plays like one of the cards in the designer's list (its Effect), which the rules file
 * carries out. A row without an Effect plays like the listed card with the same name, so the
 * designer's own spreadsheet uploads as it is.
 */

/** The cards of the designer's list in the rules file; a deck's Effect names one of them. */
export function raccoonEffects(rules: string): DeckEffect[] {
  return parseGameYaml(rules).cards.flatMap((c) =>
    'name' in c && typeof c.attrs?.effect === 'string' ? [{ id: c.attrs.effect, label: c.name, description: String(c.attrs.text ?? '') }] : [],
  );
}

const DECK_ID_PREFIX = 'rascally-raccoons-';
const HAND_SIZE = 6;
const MAX_PLAYERS = 6;

const key = (value: unknown) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '');

// Other names card lists use for the Text column, as attribute names (see attrName).
const TEXT_ALIASES = ['ability', 'cardText', 'rulesText', 'abilityText'];

/** Checks each row and gives it the Effect id the rules use. Copies (or Count) is how many go in the deck, one by default. */
export function normalizeRaccoonDeck(rules: string, rows: CardRow[]): CardRow[] {
  const effects = raccoonEffects(rules);
  const effectId = (value: unknown) => effects.find((e) => key(e.id) === key(value) || key(e.label) === key(value))?.id;
  const issues: string[] = [];
  const cards = rows.map((row) => {
    const problem = (text: string) => issues.push(`${row.name}: ${text}`);
    const { effect, text, ...rest } = row.attrs;
    const id = effectId(effect ?? row.name);
    if (!id) {
      problem(
        effect === undefined
          ? `not a card from the Rascally Raccoons list; add an Effect column naming the card it plays like (${effects.map((e) => e.label).join(', ')})`
          : `unknown Effect "${effect}"; use one of ${effects.map((e) => e.label).join(', ')}`,
      );
    }
    if (row.perPlayer !== undefined) problem('Rascally Raccoons has one shared deck; use Copies instead of Per Player');
    const alias = TEXT_ALIASES.find((a) => a in rest);
    const cardText = text ?? (alias === undefined ? undefined : rest[alias]);
    const attrs: CardRow['attrs'] = { effect: id ?? '' };
    if (cardText !== undefined) attrs.text = cardText;
    return { name: row.name, count: row.count ?? 1, attrs };
  });
  const copies = (effect: string) => cards.reduce((n, c) => n + (c.attrs.effect === effect ? c.count : 0), 0);
  const percy = copies('percy');
  const raccoons = copies('raccoon');
  const others = cards.reduce((n, c) => n + c.count, 0) - percy - raccoons;
  if (percy === 0) issues.push('The deck needs a Percy the Dog card');
  if (raccoons === 0) issues.push('The deck needs at least one Rascally Raccoon card');
  if (percy > 0 && others + percy < HAND_SIZE * 2) {
    issues.push(`The deck needs at least ${HAND_SIZE * 2 - percy} cards besides Percy and the Raccoons to deal ${HAND_SIZE} cards to 2 players; it has ${others}`);
  }
  if (issues.length) throw new DeckError(issues);
  return cards;
}

/** How many players the deck has enough cards for: everyone starts with 6 cards, Percy included. */
export function raccoonMaxPlayers(cards: CardRow[]): number {
  const dealable = cards.reduce((n, c) => n + (c.attrs.effect === 'raccoon' ? 0 : (c.count ?? 1)), 0);
  return Math.min(MAX_PLAYERS, Math.floor(dealable / HAND_SIZE));
}

/** The Rascally Raccoons rules with the designer's cards replaced by this deck. */
export function raccoonDeckGame(rules: string, rows: CardRow[], deckName: string): GameEntry {
  const cards = normalizeRaccoonDeck(rules, rows);
  const doc = parseDocument(rules);
  doc.set('cards', doc.createNode([]));
  const slug = deckName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck';
  doc.set('id', `${DECK_ID_PREFIX}${slug}`);
  doc.set('name', `Rascally Raccoons: ${deckName.trim() || 'Deck'}`);
  doc.set('players', Object.assign(doc.createNode({ min: 2, max: raccoonMaxPlayers(cards) }), { flow: true }));
  const source = mergeCardList(doc.toString({ lineWidth: 0 }), cards);
  return { game: loadGame(source), source, builtin: false };
}

/** Whether a saved game is an uploaded Rascally Raccoons deck. */
export const isRaccoonDeck = (id: string) => id.startsWith(DECK_ID_PREFIX);

export const RACCOON_COLUMNS = ['Card Name', 'Text', 'Copies', 'Effect'];

/** A deck game's cards as a CSV in the template's columns, with each Effect named after its card in the rules file. */
export function raccoonDeckCsv(rules: string, source: string): string {
  const effects = raccoonEffects(rules);
  const cards = parseDocument(source).get('cards');
  const cell = (v: unknown) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = (isSeq(cards) ? cards.items : []).flatMap((item) => {
    if (!isMap(item)) return [];
    const c = item.toJSON() as { name: string; count?: unknown; attrs?: Record<string, unknown> };
    const a = c.attrs ?? {};
    const effect = effects.find((e) => e.id === a.effect)?.label ?? a.effect;
    return [[c.name, a.text, c.count, effect].map(cell).join(',')];
  });
  return [RACCOON_COLUMNS.join(','), ...rows].join('\n') + '\n';
}
