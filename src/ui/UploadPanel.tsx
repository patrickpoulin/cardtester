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

export function UploadPanel({ games, onAdd, onRemove }: Props) {
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
    <>
      <section className="card">
        <h2>Not Snap</h2>
        <p className="muted">
          Card Tester plays Not Snap, a Marvel Snap-style game: two players, six turns, three locations, energy that grows each turn, and
          whoever wins two locations wins. The rules stay the same; what you test is a new deck of cards. Each card has a cost, a power and
          optionally one of these abilities:
        </p>
        <table className="effects">
          <thead>
            <tr>
              <th>Effect</th>
              <th>What it does</th>
            </tr>
          </thead>
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
        <div className="actions">
          <a className="button primary" href={`${TEMPLATES}deck-template.xlsx`} download>
            Download the deck template (Excel)
          </a>
          <button onClick={() => downloadFile('deck-template.csv', deckCsv(NOT_SNAP_RULES))}>Download it as CSV</button>
        </div>
        <p className="muted small">
          The template holds the starter deck, one row per card: Name, Per Player (copies in each player's deck, 1 if empty), Cost, Power,
          Effect, Amount, and Ability (the card text, for people; it isn't used in play).
        </p>
      </section>

      <section className="card">
        <h2>Upload Your Deck</h2>
        <p className="muted">
          Upload your deck as Excel (.xlsx) or CSV. It's checked and played in a few test games, then added to the Simulate and Compare
          tabs, where you can test it against the starter deck.
        </p>
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
          </>
        )}
        <div className="actions">
          <button className="primary" onClick={check} disabled={!deck || !deckName.trim()}>
            Check and add deck
          </button>
        </div>
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
      </section>

      {decks.length > 0 && (
        <section className="card">
          <h2>Your decks</h2>
          <p className="muted small">Kept in this browser. Download a deck to keep a backup, edit it, or use it in another browser.</p>
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
        </section>
      )}
    </>
  );
}
