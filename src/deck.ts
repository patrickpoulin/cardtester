import { isMap, isSeq, parseDocument } from 'yaml';
import { type CardRow, mergeCardList } from './cardList';
import { abilityAttrs, abilityKey, hasCode, rulesWithAbilities, type CardAbility } from './ai/abilities';
import { loadGame } from './dsl/compile';
import type { GameEntry } from './games';

/*
 * A deck for Not Snap: one row per card with its cost, power and optionally its ability, played
 * with the fixed Not Snap rules. An ability is card text (the Ability column) translated into rules
 * by Claude (src/ai). An older deck may instead name one of the EFFECTS below with an Amount; those
 * are carried out by the rules file and still work.
 */

export interface DeckEffect {
  id: string;
  label: string;
  description: string;
}

export const EFFECTS: DeckEffect[] = [
  { id: 'draw', label: 'On Reveal: Draw', description: 'On Reveal: draw Amount cards (up to the hand limit).' },
  { id: 'boost-here', label: 'On Reveal: Boost my other cards here', description: 'On Reveal: your other cards at this location get +Amount power.' },
  { id: 'weaken-here', label: 'On Reveal: Weaken enemy cards here', description: "On Reveal: your opponent's cards at this location get -Amount power." },
  { id: 'contested', label: 'On Reveal: +Power if an enemy is here', description: 'On Reveal: if your opponent has a card at this location, this card gets +Amount power.' },
  { id: 'alone', label: 'On Reveal: +Power if alone here', description: 'On Reveal: if this is your only card at this location, it gets +Amount power.' },
  { id: 'destroy-enemy', label: 'On Reveal: Destroy the weakest enemy here', description: "On Reveal: destroy your opponent's lowest-power card at this location (Amount isn't used)." },
  {
    id: 'destroy-own',
    label: 'On Reveal: Destroy my weakest other card here, +Power',
    description: 'On Reveal: if you have another card at this location, destroy your lowest-power one and this card gets +Amount power.',
  },
  { id: 'ongoing-boost', label: 'Ongoing: Boost my other cards here', description: 'Ongoing: your other cards at this location have +Amount power.' },
  { id: 'ongoing-weaken', label: 'Ongoing: Weaken enemy cards here', description: "Ongoing: your opponent's cards at this location have -Amount power." },
  { id: 'ongoing-full', label: 'Ongoing: +Power if my side here is full', description: 'Ongoing: if your side of this location is full, this card has +Amount power.' },
  { id: 'destroyed-draw', label: 'When Destroyed: Draw', description: 'When this card is destroyed, its owner draws Amount cards (up to the hand limit).' },
  { id: 'destroyed-boost', label: 'When Destroyed: Boost my other cards here', description: "When this card is destroyed, its owner's other cards at that location get +Amount power." },
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

// Other names card lists use for the deck columns, as attribute names (see attrName): "Casting Cost" is castingCost.
const ALIASES: Record<string, string[]> = {
  cost: ['castingCost', 'manaCost', 'energyCost', 'energy', 'mana'],
  power: ['attack', 'atk', 'strength'],
  ability: ['text', 'cardText', 'rulesText', 'abilityText'],
};

/** Checks each row (an empty Cost or Power is 0) and turns its Effect into the id the rules use. Each player gets Per Player (or Count) copies of a card, one by default. */
export function normalizeDeck(rows: CardRow[]): CardRow[] {
  const issues: string[] = [];
  const cards = rows.map((row) => {
    const attrs = { ...row.attrs };
    for (const [key, names] of Object.entries(ALIASES)) {
      if (key in attrs) continue;
      const alias = names.find((n) => n in attrs);
      if (alias === undefined) continue;
      attrs[key] = attrs[alias];
      delete attrs[alias];
    }
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
      if (id === 'destroy-enemy') attrs.amount ??= 0; // destroying needs no number
      if (typeof attrs.amount !== 'number' || !Number.isInteger(attrs.amount)) problem('an Effect needs a whole-number Amount');
    } else if (attrs.amount !== undefined) problem('Amount is set but Effect is empty');
    // Not Snap has no shared piles, so Count means copies in each player's deck too.
    return { name: row.name, perPlayer: row.perPlayer ?? row.count ?? 1, attrs };
  });
  if (!cards.length) issues.push('The deck has no cards');
  if (issues.length) throw new DeckError(issues);
  return cards;
}

/** Abilities translated from card text, by abilityKey of the text. */
export type AbilityBook = Map<string, CardAbility>;

/**
 * Gives each card whose Ability text has a translation (and no Effect) the rules for it: the card's
 * `ai` attribute names its ability, and the rules get the code. Cards that share a text share an id.
 */
export function withAbilities(rules: string, cards: CardRow[], book?: AbilityBook): { rules: string; cards: CardRow[] } {
  const ids = new Map<string, string>();
  const used = new Map<string, CardAbility>();
  const marked = cards.map((c) => {
    const text = c.attrs.ability;
    if (!book || c.attrs.effect !== undefined || typeof text !== 'string' || !text.trim()) return { card: c, id: '' };
    const ability = book.get(abilityKey(text));
    if (!ability || !hasCode(ability)) return { card: c, id: '' };
    let id = ids.get(ability.text);
    if (!id) {
      id = `a${ids.size + 1}`;
      ids.set(ability.text, id);
      used.set(id, ability);
    }
    return { card: c, id };
  });
  if (!used.size) return { rules, cards };
  return {
    rules: rulesWithAbilities(rules, used),
    cards: marked.map(({ card, id }) => ({ ...card, attrs: { ...card.attrs, ...abilityAttrs(id) } })),
  };
}

/** The Not Snap rules with the starter deck replaced by this deck, and the cards' translated abilities if a book is given. */
export function deckGame(baseRules: string, rows: CardRow[], deckName: string, book?: AbilityBook): GameEntry {
  const { rules, cards } = withAbilities(baseRules, normalizeDeck(rows), book);
  const doc = parseDocument(rules);
  doc.set('cards', doc.createNode([]));
  const slug = deckName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck';
  doc.set('id', `${DECK_ID_PREFIX}${slug}`);
  doc.set('name', `Not Snap: ${deckName.trim() || 'Deck'}`);
  const source = mergeCardList(doc.toString({ lineWidth: 0 }), cards);
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
