import { useState } from 'react';
import { BUILTIN_GAMES, type GameEntry } from '../games';
import { SimulatePanel } from './SimulatePanel';
import { SettingsPanel } from './SettingsPanel';
import { UploadPanel } from './UploadPanel';

const TABS = [
  { id: 'simulate', label: 'Simulate' },
  { id: 'upload', label: 'Upload a game' },
  { id: 'settings', label: 'Settings' },
] as const;

type Tab = (typeof TABS)[number]['id'];

export function App() {
  const [tab, setTab] = useState<Tab>('simulate');
  const [games, setGames] = useState<GameEntry[]>(BUILTIN_GAMES);
  const [selectedId, setSelectedId] = useState(BUILTIN_GAMES[0].game.id);

  function addGame(entry: GameEntry) {
    setGames((prev) => [...prev.filter((g) => g.game.id !== entry.game.id), entry]);
    setSelectedId(entry.game.id);
    setTab('simulate');
  }

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
        {tab === 'simulate' && <SimulatePanel games={games} selectedId={selectedId} onSelect={setSelectedId} />}
        {tab === 'upload' && <UploadPanel games={games} onAdd={addGame} />}
        {tab === 'settings' && <SettingsPanel />}
      </main>
    </div>
  );
}
