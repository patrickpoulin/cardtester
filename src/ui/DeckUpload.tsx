import { useState } from 'react';
import { type CardRow, readCardList } from '../cardList';
import { DeckError, deckCsv, deckGame, EFFECTS } from '../deck';
import { GameDefinitionError } from '../dsl/compile';
import { smokeTest } from '../dsl/smoke';
import { type GameEntry, NOT_SNAP_RULES } from '../games';
import { downloadFile } from './download';

const TEMPLATES = `${import.meta.env.BASE_URL}templates/`;

interface Props {
  games: GameEntry[];
  onAdd(entry: GameEntry): void;
  onRemove(id: string): void;
}

export function DeckUpload({ games, onAdd, onRemove }: Props) {
  const [deck, setDeck] = useState<{ fileName: string; rows: CardRow[] } | null>(null);
  const [deckName, setDeckName] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const decks = games.filter((g) => !g.builtin);

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

  function check() {
    if (!deck) return;
    try {
      const entry = deckGame(NOT_SNAP_RULES, deck.rows, deckName);
      const problems = smokeTest(entry.game);
      if (problems.length) {
        setIssues(problems);
        return;
      }
      setIssues([]);
      setDeck(null);
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
        Test a new deck of cards against the rules of Not Snap, a Marvel Snap-style game: two players, six turns, three locations,
        energy that grows each turn, and whoever wins two locations wins. Start from the deck template (it holds the starter deck), change
        the cards, and upload it as Excel or CSV. It's checked and played in a few test games, then you can simulate it below or compare
        it with the starter deck.
      </p>
      <div className="actions tight">
        <a className="button" href={`${TEMPLATES}deck-template.xlsx`} download>
          Download the deck template (Excel)
        </a>
        <button onClick={() => downloadFile('deck-template.csv', deckCsv(NOT_SNAP_RULES))}>Download it as CSV</button>
      </div>
      <details className="source">
        <summary>Deck columns and effects</summary>
        <p className="muted small">
          One row per card: Name, Per Player (copies in each player's deck, 1 if empty), Cost and Power (0 if empty), Effect, Amount, and Ability (the
          card text, for people; it isn't used in play). Columns named Casting Cost, Attack or Text work as Cost, Power and Ability, and other columns are ignored. Effect is optional and must be one of these:
        </p>
        <table className="effects">
          <tbody>
            {EFFECTS.map((e) => (
              <tr key={e.id}>
                <td className="nowrap">{e.label}</td>
                <td>{e.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Locations: Plains has no effect, cards played to the Forge get +1 power, and cards in the Bog have -1 power.</p>
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
          <h3>Your decks</h3>
          <ul className="game-list">
            {decks.map((g) => (
              <li key={g.game.id}>
                <span>{g.game.name}</span>
                <span className="nowrap">
                  <button className="link" onClick={() => downloadFile(`${g.game.id}.csv`, deckCsv(g.source))}>
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
