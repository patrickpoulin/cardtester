import { useEffect, useRef, useState } from 'react';
import { DECK_FORMATS, builtinGame } from '../deckFormats';
import type { GameEntry } from '../games';
import { fetchSheetTabs, savedSheet, saveSheet, sheetFormat, sheetGames, sheetIdFromLink, type SheetTabs } from '../sheet';

interface Props {
  /** Replaces the decks with the sheet's, built with the rules of the game the sheet names. `choose` is true when the person asked for the load. */
  onLoad(games: GameEntry[], choose: boolean): void;
}

interface Status {
  kind: 'ok' | 'cached' | 'error';
  text: string;
  issues: string[];
  notes: string[];
}

const time = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
/** The browser remembers one sheet. */
const STORE = 'current';
const sheetUrl = (id: string, page: string) => `https://docs.google.com/spreadsheets/d/${id}/${page}`;

/** A link given as ?sheet=… is used once and remembered. */
function linkFromAddress(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('sheet');
  } catch {
    return null;
  }
}

export function SheetSource({ onLoad }: Props) {
  const [link, setLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const started = useRef(false);

  function show(tabs: SheetTabs, fetchedAt: number, cached: string | null, choose: boolean) {
    const format = sheetFormat(tabs);
    const result = sheetGames(format, tabs, fetchedAt);
    onLoad(result.games, choose && result.games.length > 0);
    const names = result.games.map((g) => g.game.name.replace(/^[^:]*:\s*/, '').replace(/\s*\(sheet\)$/, '')).join(', ');
    const decks = (result.games.length === 1 ? '1 deck' : `${result.games.length} decks`) + (names ? ` (${names})` : '');
    const game = builtinGame(format.gameId).game.name;
    setStatus({
      kind: cached ? 'cached' : result.games.length ? 'ok' : 'error',
      text: cached
        ? `${cached} Using the copy from ${time(fetchedAt)}: ${game}, ${decks}.`
        : `Loaded ${game} from the sheet at ${time(fetchedAt)}: ${decks}.`,
      issues: result.issues,
      notes: result.notes,
    });
  }

  function fail(err: unknown) {
    setStatus({ kind: 'error', text: err instanceof Error ? err.message : String(err), issues: [], notes: [] });
    onLoad([], false);
  }

  async function load(sheetLink: string, choose: boolean) {
    const id = sheetIdFromLink(sheetLink);
    if (!id) {
      setStatus({ kind: 'error', text: "That doesn't look like a Google Sheets link.", issues: [], notes: [] });
      return;
    }
    setLoading(true);
    const saved = savedSheet(STORE);
    let tabs: SheetTabs;
    try {
      tabs = await fetchSheetTabs(id);
    } catch (err) {
      // Offline or unreachable: use the last copy of this sheet that loaded.
      const message = err instanceof Error ? err.message : String(err);
      saveSheet(STORE, { ...saved, link: sheetLink });
      try {
        if (saved?.tabs && saved.fetchedAt && saved.link === sheetLink) show(saved.tabs, saved.fetchedAt, message, choose);
        else fail(err);
      } catch (inner) {
        fail(inner);
      }
      setLoading(false);
      return;
    }
    try {
      const fetchedAt = Date.now();
      saveSheet(STORE, { link: sheetLink, fetchedAt, tabs });
      show(tabs, fetchedAt, null, choose);
    } catch (err) {
      fail(err);
    } finally {
      setLoading(false);
    }
  }

  // The remembered sheet is read again each time the site opens.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const fromAddress = linkFromAddress();
    const saved = fromAddress ?? savedSheet(STORE)?.link ?? '';
    setLink(saved);
    if (saved) load(saved, Boolean(fromAddress));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function forget() {
    saveSheet(STORE, null);
    setLink('');
    setStatus(null);
    onLoad([], false);
  }

  return (
    <section className="card">
      <h2>Your Google Sheet</h2>
      <p className="muted">
        The game, its settings and its decks all come from a Google Sheet, so you change cards and rules there and test them here. Start from
        an example: make your own copy, share your copy as "Anyone with the link can view", and paste its link below. The site reads the
        sheet each time it opens; click Reload from sheet after you change it.
      </p>
      <table className="effects examples">
        <tbody>
          {DECK_FORMATS.map((f) => {
            const game = builtinGame(f.gameId).game;
            return (
              <tr key={f.gameId}>
                <td>
                  <strong>{game.name}</strong> example
                  <div className="muted small">{game.description}</div>
                </td>
                <td className="nowrap">
                  <a href={sheetUrl(f.exampleSheet, 'copy')} target="_blank" rel="noreferrer">
                    Make a copy
                  </a>
                  {' · '}
                  <a href={sheetUrl(f.exampleSheet, 'edit?usp=sharing')} target="_blank" rel="noreferrer">
                    View
                  </a>
                  {' · '}
                  <button
                    className="link"
                    disabled={loading}
                    onClick={() => {
                      const example = sheetUrl(f.exampleSheet, 'edit');
                      setLink(example);
                      load(example, true);
                    }}
                  >
                    Try it
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <details className="source">
        <summary>What the sheet needs</summary>
        <ul className="small">
          <li>
            A <strong>Decks</strong> tab with Game ({DECK_FORMATS.map((f) => builtinGame(f.gameId).game.name).join(' or ')}), Deck name and Tab
            columns, one row per deck.
          </li>
          {DECK_FORMATS.map((f) => (
            <li key={f.gameId}>
              {builtinGame(f.gameId).game.name}: one tab per deck with columns {f.columns.join(', ')}; an optional <strong>Settings</strong> tab
              (Setting, Value) can change {f.settings.join(', ')}.
            </li>
          ))}
        </ul>
      </details>
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
