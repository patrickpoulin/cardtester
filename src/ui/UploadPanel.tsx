import { useRef, useState } from 'react';
import { GameDefinitionError, loadGame } from '../dsl/compile';
import { smokeTest } from '../dsl/smoke';
import type { GameEntry } from '../games';
import { downloadFile } from './download';
import { RulesUpload } from './RulesUpload';

const TEMPLATES = `${import.meta.env.BASE_URL}templates/`;

interface Props {
  games: GameEntry[];
  onAdd(entry: GameEntry): void;
  onRemove(id: string): void;
  onOpenSettings(): void;
}

export function UploadPanel({ games, onAdd, onRemove, onOpenSettings }: Props) {
  const [source, setSource] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const editor = useRef<HTMLElement>(null);
  const yours = games.filter((g) => !g.builtin);

  function check() {
    try {
      const game = loadGame(source);
      if (games.some((g) => g.builtin && g.game.id === game.id)) {
        setIssues([`id: "${game.id}" is a built-in game; give your game a different id`]);
        return;
      }
      const problems = smokeTest(game);
      if (problems.length) {
        setIssues(problems);
        return;
      }
      setIssues([]);
      onAdd({ game, source, builtin: false });
    } catch (err) {
      setIssues(err instanceof GameDefinitionError ? err.issues : [err instanceof Error ? err.message : String(err)]);
    }
  }

  function edit(yaml: string) {
    setSource(yaml);
    setIssues([]);
    editor.current?.scrollIntoView({ behavior: 'smooth' });
  }

  const builtins = games.filter((g) => g.builtin);
  const template = builtins.find((g) => g.game.id === 'lane-clash');

  return (
    <>
      <section className="card">
        <h2>Templates</h2>
        <p className="muted">Starting points for your own game. Fill them in and upload them below, or edit the game file directly.</p>
        <ul className="template-list">
          {template && (
            <li>
              <button className="link inline" onClick={() => downloadFile('lane-clash.yaml', template.source, 'text/yaml')}>
                Game file template (.yaml)
              </button>
              <span className="muted small">
                Lane Clash, a Marvel Snap-style game with three locations, energy, and On Reveal and Ongoing abilities. Every section is explained.
              </span>
            </li>
          )}
          <li>
            <a href={`${TEMPLATES}card-list-template.xlsx`} download>
              Card list template (Excel)
            </a>
            <span className="muted small">Lane Clash's cards and locations as an example, with a sheet explaining each column.</span>
          </li>
          <li>
            <a href={`${TEMPLATES}card-list-template.csv`} download>
              Card list template (CSV)
            </a>
            <span className="muted small">The same card list as a CSV file.</span>
          </li>
        </ul>
        <p className="muted small">
          More example game files:{' '}
          {builtins
            .filter((g) => g !== template)
            .map((g, i) => (
              <span key={g.game.id}>
                {i > 0 && ' · '}
                <button className="link inline" onClick={() => downloadFile(`${g.game.id}.yaml`, g.source, 'text/yaml')}>
                  {g.game.name}
                </button>
              </span>
            ))}
        </p>
      </section>

      <RulesUpload onAdd={onAdd} onOpenSettings={onOpenSettings} onEdit={edit} />

      <section className="card" ref={editor}>
        <h2>Paste or edit a game file</h2>
        <p className="muted">
          Already have your game written as a <code>game.yaml</code> file, or want to adjust one Claude wrote? Edit it here. The format is described
          in{' '}
          <a href="https://github.com/patrickpoulin/cardtester/blob/main/docs/game-format.md" target="_blank" rel="noreferrer">
            docs/game-format.md
          </a>
          .
        </p>
        <label className="stack">
          Start from an example
          <select value="" onChange={(e) => edit(games.find((g) => g.game.id === e.target.value)?.source ?? '')}>
            <option value="" disabled>
              Choose a game to copy…
            </option>
            {games.map((g) => (
              <option key={g.game.id} value={g.game.id}>
                {g.game.name}
              </option>
            ))}
          </select>
        </label>
        <label className="stack">
          game.yaml
          <textarea className="code" rows={18} spellCheck={false} value={source} onChange={(e) => setSource(e.target.value)} />
        </label>
        <div className="actions">
          <button className="primary" onClick={check} disabled={!source.trim()}>
            Check and add game
          </button>
        </div>
        {issues.length > 0 && (
          <div className="error">
            <p>
              {issues.length === 1 ? 'There is a problem' : `There are ${issues.length} problems`} with the file or with test games played
              from it:
            </p>
            <ul className="issues">
              {issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {yours.length > 0 && (
        <section className="card">
          <h2>Your games</h2>
          <p className="muted small">Kept in this browser. Use "Edit" to change a game, or copy its file somewhere safe to keep a backup.</p>
          <ul className="game-list">
            {yours.map((g) => (
              <li key={g.game.id}>
                <span>{g.game.name}</span>
                <span className="nowrap">
                  <button className="link" onClick={() => edit(g.source)}>
                    Edit
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
