import type { GameRecord, SimConfig } from '../engine/simulate';
import type { Summary } from '../engine/stats';

/*
 * Saved runs and the user's own games live in this browser's IndexedDB. Storage can be unavailable (private windows,
 * blocked site data), so callers must handle rejected promises; the app works without it.
 */

export type StoredRecord = Omit<GameRecord, 'cardPlays'>;

export interface SavedRun {
  id?: number;
  createdAt: string;
  label: string;
  config: SimConfig;
  summary: Summary;
  /** Per-game results, kept for runs up to MAX_STORED_RECORDS games. */
  records?: StoredRecord[];
}

/** A game the user uploaded or pasted, kept so it's still there next visit. */
export interface SavedGame {
  id: string;
  source: string;
  savedAt: string;
}

const DB = 'cardtester';
const RUNS = 'runs';
const GAMES = 'games';
const MAX_STORED_RECORDS = 20_000;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('This browser has no storage for saved runs'));
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(RUNS)) db.createObjectStore(RUNS, { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains(GAMES)) db.createObjectStore(GAMES, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open saved runs'));
  });
}

async function withStore<T>(name: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(name, mode).objectStore(name));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Saved runs storage failed'));
    });
  } finally {
    db.close();
  }
}

export function makeSavedRun(label: string, config: SimConfig, summary: Summary, records: GameRecord[]): SavedRun {
  return {
    createdAt: new Date().toISOString(),
    label,
    config,
    summary,
    records: records.length <= MAX_STORED_RECORDS ? records.map(({ cardPlays: _omit, ...rest }) => rest) : undefined,
  };
}

export async function saveRun(run: SavedRun): Promise<number> {
  return Number(await withStore(RUNS, 'readwrite', (s) => s.add(run)));
}

export async function listRuns(): Promise<SavedRun[]> {
  const runs = await withStore<SavedRun[]>(RUNS, 'readonly', (s) => s.getAll());
  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteRun(id: number): Promise<void> {
  await withStore(RUNS, 'readwrite', (s) => s.delete(id));
}

export async function saveGame(id: string, source: string): Promise<void> {
  await withStore(GAMES, 'readwrite', (s) => s.put({ id, source, savedAt: new Date().toISOString() } satisfies SavedGame));
}

export async function listGames(): Promise<SavedGame[]> {
  const games = await withStore<SavedGame[]>(GAMES, 'readonly', (s) => s.getAll());
  return games.sort((a, b) => a.savedAt.localeCompare(b.savedAt));
}

export async function deleteGame(id: string): Promise<void> {
  await withStore(GAMES, 'readwrite', (s) => s.delete(id));
}
