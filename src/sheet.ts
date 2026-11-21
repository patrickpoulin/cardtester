import { isMap, parseDocument } from 'yaml';
import { type CardRow, cardRows, CardListError, parseDelimited } from './cardList';
import { DeckError } from './deck';
import type { DeckFormat } from './deckFormats';
import { GameDefinitionError } from './dsl/compile';
import { smokeTest } from './dsl/smoke';
import type { GameEntry } from './games';

/*
 * A game's decks and settings kept in a Google Sheet, read by the browser each time the site opens.
 * The sheet is shared as "Anyone with the link can view" and each tab is read as CSV through Google's
 * query endpoint, so no API key or sign-in is needed. The tabs:
 *
 * - Decks: Deck name, Tab (the tab holding its cards). One row per deck.
 * - Settings (optional): Setting, Value. Each setting must be one the game's rules file declares
 *   under vars.shared; it replaces that value for every deck in the sheet.
 * - One tab per deck, in the same columns as the game's deck template.
 *
 * Other tabs (Effects, Rules) are for people and are not read.
 */

export const DECKS_TAB = 'Decks';
export const SETTINGS_TAB = 'Settings';

/** The spreadsheet id in a Google Sheets link, or the id itself. */
export function sheetIdFromLink(link: string): string | null {
  const trimmed = link.trim();
  const match = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(trimmed);
  if (match) return match[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(trimmed) ? trimmed : null;
}

/** The CSV of one tab, by name, with its first row as the header. */
export function tabCsvUrl(sheetId: string, tab: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(tab)}`;
}

export class SheetError extends Error {}

/** The text of each tab that was read, by tab name. */
export type SheetTabs = Record<string, string>;

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const table = (csv: string) => parseDelimited(csv, ',').filter((r) => r.some((c) => c.trim() !== ''));
const header = (csv: string) => (table(csv)[0] ?? []).map((h) => h.trim().toLowerCase());
const col = (headers: string[], ...names: string[]) => headers.findIndex((h) => names.includes(h));

/** The decks the Decks tab lists: [deck name, tab]. */
export function deckList(decksCsv: string): { name: string; tab: string }[] {
  const rows = table(decksCsv);
  const h = (rows[0] ?? []).map((c) => c.trim().toLowerCase());
  const nameCol = col(h, 'deck name', 'deck', 'name');
  const tabCol = col(h, 'tab', 'sheet');
  if (nameCol < 0 || tabCol < 0) throw new SheetError(`The ${DECKS_TAB} tab needs "Deck name" and "Tab" columns`);
  return rows
    .slice(1)
    .map((r) => ({ name: (r[nameCol] ?? '').trim(), tab: (r[tabCol] ?? '').trim() }))
    .filter((d) => d.name || d.tab)
    .map((d) => ({ name: d.name || d.tab, tab: d.tab || d.name }));
}

/** Reads the Decks tab, the Settings tab and every deck tab the Decks tab lists. */
export async function fetchSheetTabs(sheetId: string, fetcher: Fetcher = (url) => fetch(url)): Promise<SheetTabs> {
  async function get(tab: string): Promise<string> {
    let res;
    try {
      res = await fetcher(tabCsvUrl(sheetId, tab));
    } catch {
      throw new SheetError(`Couldn't reach the sheet. Check that it's shared as "Anyone with the link can view" and that you're online.`);
    }
    if (!res.ok) throw new SheetError(`The sheet answered with error ${res.status} for the "${tab}" tab. Check the link and that the sheet is shared as "Anyone with the link can view".`);
    const text = await res.text();
    if (/^\s*</.test(text)) throw new SheetError(`Couldn't read the sheet. Check that it's shared as "Anyone with the link can view".`);
    return text;
  }
  const tabs: SheetTabs = { [DECKS_TAB]: await get(DECKS_TAB) };
  const decks = deckList(tabs[DECKS_TAB]);
  const names = [SETTINGS_TAB, ...new Set(decks.map((d) => d.tab))].filter((t) => t !== DECKS_TAB);
  const texts = await Promise.all(names.map(get));
  names.forEach((name, i) => (tabs[name] = texts[i]));
  return tabs;
}

/**
 * Google answers a request for a tab that doesn't exist with the first tab instead, so each tab is
 * checked by its header row: the tab that came back must not be the Decks or Settings tab.
 */
function isOtherTab(csv: string, wanted: string): boolean {
  const h = header(csv);
  const looksLikeDecks = col(h, 'deck name') >= 0 && col(h, 'tab') >= 0;
  const looksLikeSettings = col(h, 'setting') >= 0 && col(h, 'value') >= 0;
  if (wanted === DECKS_TAB) return !looksLikeDecks;
  if (wanted === SETTINGS_TAB) return !looksLikeSettings;
  return looksLikeDecks || looksLikeSettings;
}

/** The rules with the Settings tab's values in place of their defaults. */
export function applySettings(
  rules: string,
  settingsCsv: string | undefined,
): { rules: string; issues: string[]; notes: string[]; changed: Record<string, number | boolean> } {
  const issues: string[] = [];
  const notes: string[] = [];
  const changed: Record<string, number | boolean> = {};
  if (settingsCsv === undefined || isOtherTab(settingsCsv, SETTINGS_TAB)) return { rules, issues, notes, changed };
  const rows = table(settingsCsv);
  const h = (rows[0] ?? []).map((c) => c.trim().toLowerCase());
  const nameCol = col(h, 'setting');
  const valueCol = col(h, 'value');
  const doc = parseDocument(rules);
  const shared = doc.getIn(['vars', 'shared']);
  if (!isMap(shared)) return { rules, issues, notes, changed };
  const defaults = shared.toJSON() as Record<string, unknown>;
  const unused: string[] = [];
  rows.slice(1).forEach((r, i) => {
    const name = (r[nameCol] ?? '').trim();
    const raw = (r[valueCol] ?? '').trim();
    if (!name) return;
    if (!(name in defaults)) {
      unused.push(name);
      return;
    }
    const current = defaults[name];
    let value: number | boolean | undefined;
    if (typeof current === 'number' && /^-?\d+(\.\d+)?$/.test(raw)) value = Number(raw);
    if (typeof current === 'boolean' && /^(true|false)$/i.test(raw)) value = raw.toLowerCase() === 'true';
    if (value === undefined) {
      issues.push(`${SETTINGS_TAB} row ${i + 2}: ${name} must be ${typeof current === 'boolean' ? 'TRUE or FALSE' : 'a number'}; using ${String(current)}`);
      return;
    }
    if (typeof value === 'number' && value < 0) {
      issues.push(`${SETTINGS_TAB} row ${i + 2}: ${name} can't be negative; using ${String(current)}`);
      return;
    }
    shared.set(name, value);
    if (value !== current) changed[name] = value;
  });
  if (unused.length) notes.push(`Not used, since the rules have no setting by that name: ${unused.join(', ')}.`);
  return { rules: doc.toString({ lineWidth: 0 }), issues, notes, changed };
}

export interface SheetGames {
  games: GameEntry[];
  /** Problems that kept a deck or setting out. */
  issues: string[];
  /** Things worth knowing that didn't stop anything. */
  notes: string[];
}

/** Builds a game for each deck in the sheet, with the sheet's settings. A deck with problems is left out and its problems listed. */
export function sheetGames(format: DeckFormat, tabs: SheetTabs, fetchedAt?: number): SheetGames {
  const decksCsv = tabs[DECKS_TAB];
  if (decksCsv === undefined || isOtherTab(decksCsv, DECKS_TAB)) throw new SheetError(`The sheet needs a tab named "${DECKS_TAB}" with Deck name and Tab columns`);
  const settings = applySettings(format.rules, tabs[SETTINGS_TAB]);
  const issues = [...settings.issues];
  const games: GameEntry[] = [];
  const decks = deckList(decksCsv);
  if (!decks.length) issues.push(`The ${DECKS_TAB} tab doesn't list any decks`);
  for (const deck of decks) {
    const csv = tabs[deck.tab];
    if (csv === undefined || isOtherTab(csv, deck.tab)) {
      issues.push(`${deck.name}: there's no tab named "${deck.tab}"`);
      continue;
    }
    try {
      const rows: CardRow[] = cardRows(parseDelimited(csv, ','));
      const entry = format.deckGame(rows, `${deck.name} (sheet)`, settings.rules);
      const problems = smokeTest(entry.game);
      if (problems.length) {
        issues.push(...problems.map((p) => `${deck.name}: ${p}`));
        continue;
      }
      games.push({ ...entry, fromSheet: true, sheet: { tab: deck.tab, fetchedAt, settings: settings.changed } });
    } catch (err) {
      const list = err instanceof DeckError || err instanceof GameDefinitionError ? err.issues : [err instanceof CardListError || err instanceof Error ? err.message : String(err)];
      issues.push(...list.map((p) => `${deck.name}: ${p}`));
    }
  }
  return { games, issues, notes: settings.notes };
}

/** What the browser keeps between visits: the sheet's link for each game and the last copy that loaded. */
export interface SavedSheet {
  link: string;
  fetchedAt: number;
  tabs: SheetTabs;
}

const key = (gameId: string) => `cardtester.sheet.${gameId}`;

export function savedSheet(gameId: string): Partial<SavedSheet> | null {
  try {
    const raw = localStorage.getItem(key(gameId));
    return raw ? (JSON.parse(raw) as Partial<SavedSheet>) : null;
  } catch {
    return null;
  }
}

export function saveSheet(gameId: string, value: Partial<SavedSheet> | null) {
  try {
    if (value === null) localStorage.removeItem(key(gameId));
    else localStorage.setItem(key(gameId), JSON.stringify(value));
  } catch {
    // Storage can be off (private windows); the sheet then just isn't remembered.
  }
}
