import { useEffect, useRef, useState } from 'react';
import { abilityKey, hasCode } from '../ai/abilities';
import { abilityTexts, savedApiKey, saveApiKey, savedBook, translateTexts } from '../ai/translate';
import { DECK_FORMATS, builtinGame } from '../deckFormats';
import type { GameEntry } from '../games';
import { fetchSheetTabs, savedSheet, saveSheet, sheetDeckRows, sheetFormat, sheetGames, sheetIdFromLink, type SheetTabs } from '../sheet';

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

/** How one card text will play. */
interface TextRow {
  text: string;
  cards: string[];
  state: 'ok' | 'partial' | 'failed' | 'untranslated';
  note: string;
}

interface Analysis {
  games: GameEntry[];
  texts: TextRow[];
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
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [built, setBuilt] = useState(false);
  const [progress, setProgress] = useState('');
  const [apiKey, setApiKey] = useState(savedApiKey);
  const started = useRef(false);

  /** Reads the sheet's decks, translating card text Claude hasn't seen when `translate` is set. Returns the decks, ready to build. */
  async function analyze(tabs: SheetTabs, fetchedAt: number, cached: string | null, translate: boolean): Promise<Analysis> {
    const format = sheetFormat(tabs);
    const failures = new Map<string, string>();
    const issues: string[] = [];
    let texts: TextRow[] = [];
    if (format.translatesText) {
      const decks = sheetDeckRows(tabs);
      const all = abilityTexts(decks);
      const missing = all.filter((t) => !savedBook().has(abilityKey(t)));
      if (missing.length && translate && apiKey.trim()) {
        try {
          const results = await translateTexts(missing, apiKey.trim(), setProgress);
          for (const r of results) if (r.problems.length) failures.set(abilityKey(r.ability.text), r.problems[0]);
        } catch (err) {
          issues.push(err instanceof Error ? err.message : String(err));
        }
      }
      const book = savedBook();
      const cardsWith = (t: string) => decks.flatMap((d) => d.rows.filter((r) => typeof r.attrs.ability === 'string' && abilityKey(r.attrs.ability) === abilityKey(t)).map((r) => r.name));
      texts = all.map((text) => {
        const a = book.get(abilityKey(text));
        const failed = failures.get(abilityKey(text));
        const row = { text, cards: [...new Set(cardsWith(text))] };
        if (a) return { ...row, state: a.unsupported ? (hasCode(a) ? 'partial' : 'failed') : 'ok', note: a.unsupported ? `${a.summary} Left out: ${a.unsupported}` : a.summary } as TextRow;
        if (failed) return { ...row, state: 'failed', note: `The translation didn't work in test play (${failed}), so the card plays without it. Rewording the text may help.` };
        return { ...row, state: 'untranslated', note: apiKey.trim() ? 'Not translated yet; click Analyze.' : 'Needs a Claude API key to translate; until then the card plays without it.' };
      });
    }
    const result = sheetGames(format, tabs, fetchedAt, savedBook());
    const names = result.games.map((g) => g.game.name.replace(/^[^:]*:\s*/, '').replace(/\s*\(sheet\)$/, '')).join(', ');
    const decks = (result.games.length === 1 ? '1 deck' : `${result.games.length} decks`) + (names ? ` (${names})` : '');
    const game = builtinGame(format.gameId).game.name;
    setStatus({
      kind: cached ? 'cached' : result.games.length ? 'ok' : 'error',
      text: cached
        ? `${cached} Using the copy from ${time(fetchedAt)}: ${game}, ${decks}.`
        : `Read ${game} from the sheet at ${time(fetchedAt)}: ${decks}.`,
      issues: [...issues, ...result.issues],
      notes: result.notes,
    });
    return { games: result.games, texts };
  }

  function fail(err: unknown) {
    setStatus({ kind: 'error', text: err instanceof Error ? err.message : String(err), issues: [], notes: [] });
    setAnalysis(null);
  }

  /** The decks become the test's; until then the Simulate setup stays hidden. */
  function build(result: Analysis | null, choose: boolean) {
    if (!result) return;
    onLoad(result.games, choose && result.games.length > 0);
    setBuilt(true);
  }

  /**
   * Analyze: reads the sheet and translates new card text. Opening the site re-reads the remembered
   * sheet without asking Claude anything (`translate` false) and builds the test straight away when
   * every text is already translated.
   */
  async function load(sheetLink: string, choose: boolean, translate = true) {
    const id = sheetIdFromLink(sheetLink);
    if (!id) {
      setStatus({ kind: 'error', text: "That doesn't look like a Google Sheets link.", issues: [], notes: [] });
      return;
    }
    setLoading(true);
    setBuilt(false);
    setAnalysis(null);
    onLoad([], false);
    const saved = savedSheet(STORE);
    const finish = (result: Analysis) => {
      setAnalysis(result);
      if (!translate && !result.texts.some((t) => t.state === 'untranslated')) build(result, choose);
    };
    let tabs: SheetTabs;
    try {
      tabs = await fetchSheetTabs(id);
    } catch (err) {
      // Offline or unreachable: use the last copy of this sheet that loaded.
      const message = err instanceof Error ? err.message : String(err);
      saveSheet(STORE, { ...saved, link: sheetLink });
      try {
        if (saved?.tabs && saved.fetchedAt && saved.link === sheetLink) finish(await analyze(saved.tabs, saved.fetchedAt, message, translate));
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
      finish(await analyze(tabs, fetchedAt, null, translate));
    } catch (err) {
      fail(err);
    } finally {
      setLoading(false);
      setProgress('');
    }
  }

  // The remembered sheet is read again each time the site opens.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const fromAddress = linkFromAddress();
    const saved = fromAddress ?? savedSheet(STORE)?.link ?? '';
    setLink(saved);
    if (saved) load(saved, Boolean(fromAddress), false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function forget() {
    saveSheet(STORE, null);
    setLink('');
    setStatus(null);
    setAnalysis(null);
    setBuilt(false);
    onLoad([], false);
  }

  const untranslated = analysis?.texts.filter((t) => t.state === 'untranslated').length ?? 0;

  return (
    <section className="card">
      <h2>Your Google Sheet</h2>
      <p className="muted">
        The game, its settings and its decks all come from a Google Sheet, so you change cards and rules there and test them here. Start from
        an example: make your own copy, share your copy as "Anyone with the link can view", and paste its link below. Click Analyze to read
        the sheet; Claude turns each card's Ability text into rules. Then click Build test. Analyze again after you change the sheet.
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
        Claude API key
        <input
          type="password"
          value={apiKey}
          placeholder="sk-ant-…"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setApiKey(e.target.value);
            saveApiKey(e.target.value.trim());
          }}
        />
      </label>
      <p className="muted small">
        Used to have Claude translate card text into rules. It's kept in this browser only and sent only to Claude. Get one in the{' '}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
          Claude Console
        </a>
        . Each text is translated once and remembered, so analyzing again only costs anything when card text changes. The examples' card text
        plays without a key.
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
          {loading ? 'Analyzing…' : 'Analyze'}
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
      {progress && <p className="muted small">{progress}</p>}
      {status?.notes.map((note, i) => (
        <p key={i} className="muted small">
          {note}
        </p>
      ))}
      {analysis && analysis.texts.length > 0 && (
        <details className="source" open={!built || analysis.texts.some((t) => t.state !== 'ok')}>
          <summary>
            How the card text will play: {analysis.texts.filter((t) => t.state === 'ok').length} of {analysis.texts.length} texts translated
            {untranslated ? `, ${untranslated} waiting for an API key` : ''}
          </summary>
          <table className="effects">
            <thead>
              <tr>
                <th>Card text</th>
                <th>Cards</th>
                <th>How it plays</th>
              </tr>
            </thead>
            <tbody>
              {analysis.texts.map((t) => (
                <tr key={t.text} className={t.state === 'ok' ? undefined : 'warn'}>
                  <td>{t.text}</td>
                  <td>{t.cards.join(', ')}</td>
                  <td>
                    {t.state === 'ok' ? '' : '⚠ '}
                    {t.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {analysis && !built && (
        <div className="actions tight">
          <button className="primary" onClick={() => build(analysis, true)} disabled={loading || !analysis.games.length}>
            Build test
          </button>
          {untranslated > 0 && (
            <span className="muted small">
              {untranslated === 1 ? '1 card text isn\'t' : `${untranslated} card texts aren't`} translated; those cards will play with just Cost
              and Power.
            </span>
          )}
        </div>
      )}
    </section>
  );
}
