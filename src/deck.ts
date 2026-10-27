import { isMap, isSeq, parseDocument } from 'yaml';
import { type CardRow, mergeCardList } from './cardList';
import { loadGame } from './dsl/compile';
import type { GameEntry } from './games';

/*
 * A deck for Not Snap: one row per card with its cost, power and optionally one ability, played
 * with the fixed Not Snap rules. The abilities are carried out by the rules file, so a deck can
 * only use the effects listed here.
 */

export interface DeckEffect {
  id: string;
  label: string;
  description: string;
}

export const EFFECTS: DeckEffect[] = [
  { id: 'draw', label: 'Draw', description: 'On Reveal: draw Amount cards (hand limit 7).' },
  { id: 'boost-here', label: 'Boost Here', description: 'On Reveal: your other cards at this location get +Amount power.' },
  { id: 'weaken-here', label: 'Weaken Here', description: "On Reveal: your opponent's cards at this location get -Amount power." },
  { id: 'contested', label: 'Contested', description: 'On Reveal: if your opponent has a card at this location, this card gets +Amount power.' },
  { id: 'alone', label: 'Alone', description: 'On Reveal: if this is your only card at this location, it gets +Amount power.' },
  { id: 'ongoing-boost', label: 'Ongoing Boost', description: 'Ongoing: your other cards at this location have +Amount power.' },
];

const DECK_ID_PREFIX = 'not-snap-';

export class DeckError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join('\n'));
  }
}

const effectId = (value: string) => {
  const key = value.toLowerCase().replace(/[^a-z]+/g, '');
  return EFFECTS.find((e) => e.id.replace(/-/g, '') === key || e.label.toLowerCase().replace(/[^a-z]+/g, '') === key)?.id;
};

/** Checks each row (an empty Cost or Power is 0) and turns its Effect into the id the rules use. Each player gets Per Player (or Count) copies of a card, one by default. */
export function normalizeDeck(rows: CardRow[]): CardRow[] {
  const issues: string[] = [];
  const cards = rows.map((row) => {
    const attrs = { ...row.attrs };
    const problem = (text: string) => issues.push(`${row.name}: ${text}`);
    for (const key of ['cost', 'power'] as const) {
      attrs[key] ??= 0; // an empty cell counts as 0
      const v = attrs[key];
      if (typeof v !== 'number' || !Number.isInteger(v)) problem(`${key === 'cost' ? 'Cost' : 'Power'} must be a whole number`);
    }
    if (typeof attrs.cost === 'number' && attrs.cost < 0) problem('Cost can\'t be negative');
    if (attrs.effect !== undefined) {
      const id = effectId(String(attrs.effect));
      if (!id) problem(`unknown Effect "${attrs.effect}"; use one of ${EFFECTS.map((e) => e.label).join(', ')}, or leave it empty`);
      else attrs.effect = id;
      if (typeof attrs.amount !== 'number' || !Number.isInteger(attrs.amount)) problem('an Effect needs a whole-number Amount');
    } else if (attrs.amount !== undefined) problem('Amount is set but Effect is empty');
    // Not Snap has no shared piles, so Count means copies in each player's deck too.
    return { name: row.name, perPlayer: row.perPlayer ?? row.count ?? 1, attrs };
  });
  if (!cards.length) issues.push('The deck has no cards');
  if (issues.length) throw new DeckError(issues);
  return cards;
}

/** The Not Snap rules with the starter deck replaced by this deck. */
export function deckGame(rules: string, rows: CardRow[], deckName: string): GameEntry {
  const doc = parseDocument(rules);
  doc.set('cards', doc.createNode([]));
  const slug = deckName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck';
  doc.set('id', `${DECK_ID_PREFIX}${slug}`);
  doc.set('name', `Not Snap: ${deckName.trim() || 'Deck'}`);
  const source = mergeCardList(doc.toString({ lineWidth: 0 }), normalizeDeck(rows));
  return { game: loadGame(source), source, builtin: false };
}

/** Whether a saved game is an uploaded Not Snap deck. */
export const isDeckGame = (id: string) => id.startsWith(DECK_ID_PREFIX);

const COLUMNS = ['Name', 'Per Player', 'Cost', 'Power', 'Effect', 'Amount', 'Ability'];

/** A deck game's cards as a CSV in the deck template's columns, so a saved deck can be downloaded and edited. */
export function deckCsv(source: string): string {
  const cards = parseDocument(source).get('cards');
  const cell = (v: unknown) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = (isSeq(cards) ? cards.items : []).flatMap((item) => {
    if (!isMap(item)) return [];
    const c = item.toJSON() as { name: string; perPlayer?: { count?: unknown }; attrs?: Record<string, unknown> };
    const a = c.attrs ?? {};
    const effect = EFFECTS.find((e) => e.id === a.effect)?.label ?? a.effect;
    return [[c.name, c.perPlayer?.count, a.cost, a.power, effect, a.amount, a.ability].map(cell).join(',')];
  });
  return [COLUMNS.join(','), ...rows].join('\n') + '\n';
}
