import { useState } from 'react';
import { GameDefinitionError, loadGame } from '../dsl/compile';
import { smokeTest } from '../dsl/smoke';
import type { GameEntry } from '../games';

interface Props {
  games: GameEntry[];
  onAdd(entry: GameEntry): void;
}

export function UploadPanel({ games, onAdd }: Props) {
  const [source, setSource] = useState('');
  const [issues, setIssues] = useState<string[]>([]);

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

  return (
    <>
      <section className="card">
        <h2>Upload a game</h2>
        <p className="muted">Coming soon. This is where you'll add your own game:</p>
        <ol className="steps">
          <li>
            <strong>Upload the rules</strong> (PDF, Word or text) and <strong>the card list</strong> (a spreadsheet, one row per card).
          </li>
          <li>
            <strong>Answer a few questions</strong> Claude asks about anything unclear in the rules.
          </li>
          <li>
            <strong>Watch one sample game</strong> to check it plays the way you expect, then simulate it like the built-in games.
          </li>
        </ol>
        <div className="dropzone muted" aria-disabled="true">
          Rules and card files will go here
        </div>
      </section>

      <section className="card">
        <h2>Paste a game file</h2>
        <p className="muted">
          Already have your game written as a <code>game.yaml</code> file? Paste it here. The format is described in{' '}
          <a href="https://github.com/patrickpoulin/cardtester/blob/main/docs/game-format.md" target="_blank" rel="noreferrer">
            docs/game-format.md
          </a>
          .
        </p>
        <label className="stack">
          Start from an example
          <select value="" onChange={(e) => setSource(games.find((g) => g.game.id === e.target.value)?.source ?? '')}>
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
        <p className="muted small">Pasted games are kept until you leave the page. Save your file somewhere to reuse it.</p>
      </section>
    </>
  );
}
