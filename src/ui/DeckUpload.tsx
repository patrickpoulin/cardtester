import { useState, type ReactNode } from 'react';
import { type CardRow, readCardList } from '../cardList';
import { DeckError } from '../deck';
import { type DeckFormat, builtinGame, pastedCardRows } from '../deckFormats';
import { GameDefinitionError } from '../dsl/compile';
import { smokeTest } from '../dsl/smoke';
import type { GameEntry } from '../games';
import { downloadFile } from './download';

const TEMPLATES = `${import.meta.env.BASE_URL}templates/`;

interface Props {
  format: DeckFormat;
  /** The uploaded decks for this game. */
  decks: GameEntry[];
  onAdd(entry: GameEntry): void;
  onRemove(id: string): void;
}

/** What each game's decks look like, for the people filling in the template. */
const GUIDES: Record<string, { intro: ReactNode; columns: ReactNode; footer?: ReactNode }> = {
  'not-snap': {
    intro: (
      <>
        Test a new deck of cards against the rules of Not Snap, a Marvel Snap-style game: two players, six turns, three locations, energy that
        grows each turn, and whoever wins two locations wins.
      </>
    ),
    columns: (
      <>
        One row per card: Name, Per Player (copies in each player's deck, 1 if empty), Cost and Power (0 if empty), Effect, Amount, and Ability
        (the card text, for people; it isn't used in play). Columns named Casting Cost, Attack or Text work as Cost, Power and Ability, and other
        columns are ignored. Effect is optional and must be one of these:
      </>
    ),
    footer: <>Locations: Plains has no effect, cards played to the Forge get +1 power, and cards in the Bog have -1 power.</>,
  },
  'rascally-raccoons': {
    intro: (
      <>
        Test a new card mix for Rascally Raccoons: change how many copies of each card there are, rename cards, or add cards that play like
        an existing one. The rules stay the same: 2-6 players, play any cards you like each turn and then draw one, and whoever holds Percy the
        Dog when the last Rascally Raccoon is revealed wins.
      </>
    ),
    columns: (
      <>
        One row per card: Card Name, Text (for people; it isn't used in play), Copies (how many are in the deck, 1 if empty) and Effect, the
        card from this list it plays like. A card whose name is on the list doesn't need an Effect, so the original card list uploads as it
        is. The deck needs Percy the Dog and at least one Rascally Raccoon, and enough other cards to deal 6 to each player; with fewer than 35
        it allows fewer than 6 players.
      </>
    ),
  },
};

export function DeckUpload({ format, decks, onAdd, onRemove }: Props) {
  const [deck, setDeck] = useState<{ fileName: string; rows: CardRow[] } | null>(null);
  const [deckName, setDeckName] = useState('');
  const [pasted, setPasted] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const builtin = builtinGame(format.gameId);
  const guide = GUIDES[format.gameId];

  // Start over when another game is chosen.
  const [shownFor, setShownFor] = useState(format.gameId);
  if (shownFor !== format.gameId) {
    setShownFor(format.gameId);
    setDeck(null);
    setPasted('');
    setIssues([]);
  }

  async function openDeck(file: File | undefined) {
    if (!file) return;
    setIssues([]);
    try {
      setDeck({ fileName: file.name, rows: await readCardList(file) });
      setDeckName(file.name.replace(/\.[^.]+$/, ''));
    } catch (err) {
      setDeck(null);
      setIssues([err instanceof Error ? err.message : String(err)]);
    }
  }

  function readPasted() {
    setIssues([]);
    try {
      setDeck({ fileName: 'Pasted rows', rows: pastedCardRows(pasted, format.columns) });
      if (!deckName.trim() || deck?.fileName !== 'Pasted rows') setDeckName('Pasted deck');
    } catch (err) {
      setDeck(null);
      setIssues([err instanceof Error ? err.message : String(err)]);
    }
  }

  function check() {
    if (!deck) return;
    try {
      const entry = format.deckGame(deck.rows, deckName);
      const problems = smokeTest(entry.game);
      if (problems.length) {
        setIssues(problems);
        return;
      }
      setIssues([]);
      setDeck(null);
      setPasted('');
      onAdd(entry);
    } catch (err) {
      setIssues(
        err instanceof DeckError || err instanceof GameDefinitionError ? err.issues : [err instanceof Error ? err.message : String(err)],
      );
    }
  }

  return (
    <section className="card">
      <h2>Upload Your Deck</h2>
      <p className="muted">
        {guide.intro} Start from the deck template (it holds the {builtin.game.name} card list), change the cards, and upload it as Excel or CSV,
        or copy the rows in your spreadsheet and paste them below. It's checked and played in a few test games, then you can simulate it below
        or compare it with the original deck.
      </p>
      <div className="actions tight">
        <a className="button" href={`${TEMPLATES}${format.template}`} download>
          Download the deck template (Excel)
        </a>
        <button onClick={() => downloadFile(`${format.gameId}-deck-template.csv`, format.deckCsv(builtin.source))}>Download it as CSV</button>
      </div>
      <details className="source">
        <summary>Deck columns and effects</summary>
        <p className="muted small">{guide.columns}</p>
        <table className="effects">
          <tbody>
            {format.effects.map((e) => (
              <tr key={e.id}>
                <td className="nowrap">{e.label}</td>
                <td>{e.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {guide.footer && <p className="muted small">{guide.footer}</p>}
      </details>
      <label className="stack">
        Deck file
        <input
          type="file"
          accept=".xlsx,.csv,.tsv,.txt"
          onChange={(e) => {
            openDeck(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      <label className="stack">
        Or paste rows from a spreadsheet
        <textarea
          rows={5}
          value={pasted}
          placeholder={`${format.columns.join('\t')}\n…`}
          onChange={(e) => setPasted(e.target.value)}
          spellCheck={false}
        />
      </label>
      <p className="muted small">
        Include the header row if you can. Without one, the columns are read in the template's order: {format.columns.join(', ')}.
      </p>
      <div className="actions tight">
        <button onClick={readPasted} disabled={!pasted.trim()}>
          Read pasted rows
        </button>
      </div>
      {deck && (
        <>
          <p className="muted small">
            {deck.fileName}: {deck.rows.length} {deck.rows.length === 1 ? 'card' : 'cards'}
          </p>
          <label className="stack">
            Deck name
            <input type="text" value={deckName} onChange={(e) => setDeckName(e.target.value)} />
          </label>
          <div className="actions">
            <button className="primary" onClick={check} disabled={!deckName.trim()}>
              Check and add deck
            </button>
          </div>
        </>
      )}
      {issues.length > 0 && (
        <div className="error">
          <p>{issues.length === 1 ? 'There is a problem' : `There are ${issues.length} problems`} with the deck:</p>
          <ul className="issues">
            {issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </div>
      )}
      {decks.length > 0 && (
        <>
          <h3>Your {builtin.game.name} decks</h3>
          <ul className="game-list">
            {decks.map((g) => (
              <li key={g.game.id}>
                <span>{g.game.name}</span>
                <span className="nowrap">
                  <button className="link" onClick={() => downloadFile(`${g.game.id}.csv`, format.deckCsv(g.source))}>
                    Download
                  </button>
                  <button className="link danger" onClick={() => onRemove(g.game.id)}>
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <p className="muted small">Kept in this browser. Download a deck to keep a backup, edit it, or use it in another browser.</p>
        </>
      )}
    </section>
  );
}
