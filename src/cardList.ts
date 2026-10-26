import { isMap, isSeq, parseDocument, type YAMLMap } from 'yaml';

/*
 * A designer's card list (CSV, TSV or Excel), uploaded beside the game file. Each row becomes a
 * cards entry: the name column names the card, Count / Zone / Per Player / Player Zone say where
 * its copies go, and every other column becomes an attribute. The game file's optional `cardList`
 * section gives the defaults for those placement columns, and a cards entry with the same name as
 * a row keeps its onPlay effects. See docs/game-format.md, "Card lists".
 */

type Cell = string | number | boolean;

export interface CardRow {
  name: string;
  count?: number;
  zone?: string;
  perPlayer?: number;
  playerZone?: string;
  attrs: Record<string, Cell>;
}

export class CardListError extends Error {}

const NAME_HEADERS = ['name', 'card name', 'card', 'unique id', 'id'];
const PLACEMENT: Record<string, 'count' | 'zone' | 'perPlayer' | 'playerZone'> = {
  count: 'count',
  copies: 'count',
  quantity: 'count',
  qty: 'count',
  zone: 'zone',
  'per player': 'perPlayer',
  'player zone': 'playerZone',
};
// Set by Card Tester itself, so they can't be attributes.
const RESERVED = new Set(['id', 'name', 'by']);

/** Reads a card list file from the browser's file picker. Excel files use their first non-empty sheet. */
export async function readCardList(file: File): Promise<CardRow[]> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xlsx')) {
    const { default: readExcelFile } = await import('read-excel-file/universal');
    const sheets = await readExcelFile(await file.arrayBuffer());
    const sheet = sheets.find((s) => s.data.some((row) => row.some((v) => v !== null && v !== '')));
    if (!sheet) throw new CardListError(`${file.name} has no data`);
    return cardRows(sheet.data.map((row) => row.map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v))));
  }
  if (lower.endsWith('.xls') || lower.endsWith('.numbers')) throw new CardListError(`${file.name}: save the spreadsheet as .xlsx or CSV first`);
  return cardRows(parseDelimited(await file.text(), lower.endsWith('.tsv') ? '\t' : undefined));
}

/** Splits CSV or TSV text into rows of cells, handling quoted cells. Guesses the delimiter from the first line when not given. */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const firstLine = text.slice(0, text.indexOf('\n') >>> 0);
  const sep = delimiter ?? (firstLine.split('\t').length > firstLine.split(',').length ? '\t' : ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) rows.push([...row, cell]);
  return rows;
}

/** "Casting Cost" → "castingCost". */
export function attrName(header: string): string {
  const words = header
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  const name = words.map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join('');
  return /^[0-9]/.test(name) ? `_${name}` : name;
}

function cellValue(v: unknown): Cell | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const s = String(v).trim();
  if (s === '') return undefined;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
  return s;
}

/** Turns a table whose first non-empty row is the header into card rows. */
export function cardRows(table: readonly (readonly unknown[])[]): CardRow[] {
  const rows = table.filter((r) => r.some((v) => cellValue(v) !== undefined));
  if (rows.length < 2) throw new CardListError('The card list needs a header row and at least one card');
  const headers = rows[0].map((h) => String(h ?? '').trim());
  const lowered = headers.map((h) => h.toLowerCase());
  const nameCol = Math.max(0, NAME_HEADERS.map((h) => lowered.indexOf(h)).find((i) => i >= 0) ?? 0);

  const seen = new Set<string>();
  return rows.slice(1).map((r, i) => {
    const line = i + 2;
    const name = cellValue(r[nameCol]);
    if (name === undefined) throw new CardListError(`Row ${line}: the "${headers[nameCol]}" column is empty`);
    const card: CardRow = { name: String(name), attrs: {} };
    if (seen.has(card.name)) throw new CardListError(`Row ${line}: "${card.name}" is listed twice`);
    seen.add(card.name);
    headers.forEach((header, col) => {
      const value = cellValue(r[col]);
      if (col === nameCol || header === '' || value === undefined) return;
      const placement = PLACEMENT[lowered[col]];
      if (placement === 'count' || placement === 'perPlayer') {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
          throw new CardListError(`Row ${line}: "${header}" must be a whole number`);
        card[placement] = value;
      } else if (placement) card[placement] = String(value);
      else {
        const key = attrName(header);
        if (key && !RESERVED.has(key)) card.attrs[key] = value;
      }
    });
    return card;
  });
}

/**
 * Adds the card list to a game file: rows matching a cards entry by name update its placement and
 * attributes (keeping its onPlay), the rest are appended. Entries that don't say where their copies
 * go get the `cardList` defaults. The
 * `cardList` section is removed either way, since the simulator doesn't read it. Comments in the
 * game file are kept.
 */
export function mergeCardList(source: string, rows: CardRow[] | null): string {
  const doc = parseDocument(source);
  if (doc.errors.length || !isMap(doc.contents)) return source; // leave the error to the game loader
  const defaults = (doc.get('cardList') ?? null) as YAMLMap | null;
  if (!rows && defaults === null) return source;
  doc.delete('cardList');
  if (!rows) return doc.toString();

  const d = (isMap(defaults) ? defaults.toJSON() : {}) as { count?: unknown; zone?: unknown; perPlayer?: { count?: unknown; zone?: unknown } };
  let cards = doc.get('cards');
  if (!isSeq(cards)) {
    cards = doc.createNode([]);
    doc.set('cards', cards);
  }
  const seq = cards as ReturnType<typeof doc.createNode> & { items: unknown[] };
  const byName = new Map<string, YAMLMap>();
  for (const item of seq.items) if (isMap(item) && typeof item.get('name') === 'string') byName.set(item.get('name') as string, item);

  const flow = (value: object) => Object.assign(doc.createNode(value), { flow: true });
  for (const row of rows) {
    let entry = byName.get(row.name);
    if (!entry) {
      entry = doc.createNode({ name: row.name }) as YAMLMap;
      seq.items.push(entry);
    }
    // An entry that doesn't say where its copies go (such as one written only for its onPlay) uses the defaults.
    if (!['count', 'zone', 'perPlayer'].some((key) => entry.has(key))) {
      if (d.count !== undefined) entry.set('count', d.count);
      if (d.zone !== undefined) entry.set('zone', d.zone);
      if (d.perPlayer) entry.set('perPlayer', flow({ ...d.perPlayer }));
    }
    if (row.count !== undefined) entry.set('count', row.count);
    if (row.zone !== undefined) entry.set('zone', row.zone);
    if (row.perPlayer !== undefined || row.playerZone !== undefined) {
      const current = (isMap(entry.get('perPlayer')) ? (entry.get('perPlayer') as YAMLMap).toJSON() : {}) as Record<string, unknown>;
      entry.set('perPlayer', flow({ count: row.perPlayer ?? current.count ?? 1, zone: row.playerZone ?? current.zone ?? 'deck' }));
    }
    const attrs = { ...((isMap(entry.get('attrs')) ? (entry.get('attrs') as YAMLMap).toJSON() : {}) as object), ...row.attrs };
    if (Object.keys(attrs).length) entry.set('attrs', flow(attrs));
  }
  return doc.toString({ lineWidth: 0 });
}
