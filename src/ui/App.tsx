import { useEffect, useState } from 'react';
import { loadGame } from '../dsl/compile';
import { formatOf, gamesOfKind } from '../deckFormats';
import { BUILTIN_GAMES, type GameEntry } from '../games';
import { deleteGame, listGames, saveGame } from '../report/storage';
import { ComparePanel } from './ComparePanel';
import { DeckUpload } from './DeckUpload';
import { GamePicker } from './GamePicker';
import { SavedRunsPanel } from './SavedRunsPanel';
import { SimulatePanel } from './SimulatePanel';

const TABS = [
  { id: 'simulate', label: 'Simulate' },
  { id: 'compare', label: 'Compare' },
  { id: 'saved', label: 'Saved runs' },
] as const;

type Tab = (typeof TABS)[number]['id'];

export function App() {
  const [tab, setTab] = useState<Tab>('simulate');
  const [games, setGames] = useState<GameEntry[]>(BUILTIN_GAMES);
  const [selectedId, setSelectedId] = useState(BUILTIN_GAMES[0].game.id);
  const [savedVersion, setSavedVersion] = useState(0);
  const onSaved = () => setSavedVersion((v) => v + 1);
  // The game chosen at the top of Simulate: a built-in game, whose uploaded decks are shown with it.
  const format = formatOf(selectedId) ?? formatOf(BUILTIN_GAMES[0].game.id)!;

  // Bring back decks uploaded on earlier visits (other games saved by older versions of the site are skipped).
  useEffect(() => {
    listGames()
      .then((saved) => {
        const entries = saved.filter((g) => formatOf(g.id) !== undefined).flatMap((g) => {
          try {
            return [{ game: loadGame(g.source), source: g.source, builtin: false }];
          } catch {
            return [];
          }
        });
        setGames((prev) => [...prev, ...entries.filter((e) => !prev.some((p) => p.game.id === e.game.id))]);
      })
      .catch(() => {});
  }, []);

  function addGame(entry: GameEntry) {
    setGames((prev) => [...prev.filter((g) => g.game.id !== entry.game.id), entry]);
    setSelectedId(entry.game.id);
    setTab('simulate');
    saveGame(entry.game.id, entry.source).catch(() => {});
  }

  function removeGame(id: string) {
    setGames((prev) => prev.filter((g) => g.builtin || g.game.id !== id));
    if (selectedId === id) setSelectedId(formatOf(id)?.gameId ?? BUILTIN_GAMES[0].game.id);
    deleteGame(id).catch(() => {});
  }

  // Panels stay mounted while hidden so results survive switching tabs.
  return (
    <div className="app">
      <header className="header">
        <h1>Card Tester</h1>
        <p className="muted">Play a card game thousands of times and see who wins, how long it takes, and which cards matter.</p>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        <div hidden={tab !== 'simulate'}>
          <GamePicker gameId={format.gameId} onChoose={setSelectedId} />
          <DeckUpload format={format} decks={gamesOfKind(games, format.gameId).filter((g) => !g.builtin)} onAdd={addGame} onRemove={removeGame} />
          <SimulatePanel games={gamesOfKind(games, format.gameId)} selectedId={selectedId} onSelect={setSelectedId} onSaved={onSaved} />
        </div>
        <div hidden={tab !== 'compare'}>
          <ComparePanel games={games} selectedId={selectedId} onSelect={setSelectedId} onSaved={onSaved} />
        </div>
        <div hidden={tab !== 'saved'}>
          <SavedRunsPanel version={savedVersion} />
        </div>
      </main>
    </div>
  );
}
