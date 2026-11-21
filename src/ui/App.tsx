import { useState } from 'react';
import type { GameEntry } from '../games';
import { ComparePanel } from './ComparePanel';
import { SavedRunsPanel } from './SavedRunsPanel';
import { SheetSource } from './SheetSource';
import { SimulatePanel } from './SimulatePanel';

const TABS = [
  { id: 'simulate', label: 'Simulate' },
  { id: 'compare', label: 'Compare' },
  { id: 'saved', label: 'Saved runs' },
] as const;

type Tab = (typeof TABS)[number]['id'];

export function App() {
  const [tab, setTab] = useState<Tab>('simulate');
  // The game and every deck come from the Google Sheet; the games' rules files only supply the rules.
  const [games, setGames] = useState<GameEntry[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [savedVersion, setSavedVersion] = useState(0);
  const onSaved = () => setSavedVersion((v) => v + 1);

  // The sheet's decks replace the ones it gave before. The first is chosen when the person loaded the sheet or the chosen deck is gone.
  function setSheetGames(entries: GameEntry[], choose: boolean) {
    setGames(entries);
    setSelectedId((id) => (!choose && entries.some((e) => e.game.id === id) ? id : (entries[0]?.game.id ?? '')));
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
          <SheetSource onLoad={setSheetGames} />
          {games.length > 0 ? (
            <SimulatePanel games={games} selectedId={selectedId} onSelect={setSelectedId} onSaved={onSaved} />
          ) : (
            <section className="card">
              <h2>Set up the test</h2>
              <p className="muted">Load a Google Sheet above to choose a deck and run games.</p>
            </section>
          )}
        </div>
        <div hidden={tab !== 'compare'}>
          <ComparePanel version={savedVersion} />
        </div>
        <div hidden={tab !== 'saved'}>
          <SavedRunsPanel version={savedVersion} />
        </div>
      </main>
    </div>
  );
}
