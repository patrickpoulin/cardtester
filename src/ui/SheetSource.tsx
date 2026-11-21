import { useEffect, useRef, useState } from 'react';
import type { DeckFormat } from '../deckFormats';
import type { GameEntry } from '../games';
import { fetchSheetTabs, savedSheet, saveSheet, sheetGames, sheetIdFromLink, type SheetTabs } from '../sheet';

interface Props {
  format: DeckFormat;
  /** Replaces this game's decks from the sheet. `choose` is true when the person asked for the load. */
  onLoad(gameId: string, games: GameEntry[], choose: boolean): void;
}

interface Status {
  kind: 'ok' | 'cached' | 'error';
  text: string;
  issues: string[];
  notes: string[];
}

const time = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/** A link given as ?sheet=… (with &game=… for a game other than the first) is used once and remembered. */
function linkFromAddress(gameId: string, firstGameId: string): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const link = params.get('sheet');
    return link && (params.get('game') ?? firstGameId) === gameId ? link : null;
  } catch {
    return null;
  }
}

export function SheetSource({ format, onLoad }: Props) {
  const gameId = format.gameId;
  const [link, setLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const loadedFor = useRef<string | null>(null);

  function show(tabs: SheetTabs, fetchedAt: number, cached: string | null, choose: boolean) {
    const result = sheetGames(format, tabs, fetchedAt);
    onLoad(gameId, result.games, choose && result.games.length > 0);
    const names = result.games.map((g) => g.game.name.replace(/^[^:]*:\s*/, '').replace(/\s*\(sheet\)$/, '')).join(', ');
    const decks = (result.games.length === 1 ? '1 deck' : `${result.games.length} decks`) + (names ? ` (${names})` : '');
    setStatus({
      kind: cached ? 'cached' : result.games.length ? 'ok' : 'error',
      text: cached ? `${cached} Using the copy from ${time(fetchedAt)}: ${decks}.` : `Loaded ${decks} from the sheet at ${time(fetchedAt)}. Choose them under "From your Google Sheet" in the Deck list below.`,
      issues: result.issues,
      notes: result.notes,
    });
  }

  async function load(sheetLink: string, choose: boolean) {
    const id = sheetIdFromLink(sheetLink);
    if (!id) {
      setStatus({ kind: 'error', text: "That doesn't look like a Google Sheets link.", issues: [], notes: [] });
      return;
    }
    setLoading(true);
    const saved = savedSheet(gameId);
    try {
      const tabs = await fetchSheetTabs(id);
      const fetchedAt = Date.now();
      saveSheet(gameId, { link: sheetLink, fetchedAt, tabs });
      show(tabs, fetchedAt, null, choose);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      saveSheet(gameId, { ...saved, link: sheetLink });
      if (saved?.tabs && saved.fetchedAt && saved.link === sheetLink) {
        try {
          show(saved.tabs, saved.fetchedAt, message, choose);
        } catch (inner) {
          setStatus({ kind: 'error', text: inner instanceof Error ? inner.message : String(inner), issues: [], notes: [] });
        }
      } else {
        setStatus({ kind: 'error', text: message, issues: [], notes: [] });
      }
    } finally {
      setLoading(false);
    }
  }

  // Each game remembers its own sheet; it's read again whenever the game is shown.
  useEffect(() => {
    if (loadedFor.current === gameId) return;
    loadedFor.current = gameId;
    const fromAddress = linkFromAddress(gameId, 'not-snap');
    const saved = fromAddress ?? savedSheet(gameId)?.link ?? '';
    setLink(saved);
    setStatus(null);
    if (saved) load(saved, Boolean(fromAddress));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  function forget() {
    saveSheet(gameId, null);
    setLink('');
    setStatus(null);
    onLoad(gameId, [], false);
  }

  return (
    <section className="card">
      <h2>Google Sheet</h2>
      <p className="muted">
        Keep your decks and settings in a Google Sheet and edit them there. Share the sheet as "Anyone with the link can view" and paste its
        link here. The site reads the sheet each time it opens; click Reload after you change it. The sheet needs a Decks tab (Deck name, Tab),
        one tab per deck in the deck template's columns, and optionally a Settings tab (Setting, Value).
      </p>
      <label className="stack">
        Sheet link
        <input
          type="url"
          value={link}
          placeholder="https://docs.google.com/spreadsheets/d/…"
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && link.trim()) load(link, true);
          }}
          spellCheck={false}
        />
      </label>
      <div className="actions tight">
        <button className="primary" onClick={() => load(link, true)} disabled={loading || !link.trim()}>
          {loading ? 'Reading the sheet…' : status ? 'Reload from sheet' : 'Load sheet'}
        </button>
        {link && (
          <button className="link" onClick={forget} disabled={loading}>
            Forget this sheet
          </button>
        )}
      </div>
      {status && (
        <div className={status.kind === 'error' || status.issues.length ? 'error' : undefined}>
          <p className={status.kind === 'ok' && !status.issues.length ? 'muted small' : undefined}>{status.text}</p>
          {status.issues.length > 0 && (
            <ul className="issues">
              {status.issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {status?.notes.map((note, i) => (
        <p key={i} className="muted small">
          {note}
        </p>
      ))}
    </section>
  );
}
