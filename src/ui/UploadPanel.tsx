import { useRef, useState } from 'react';
import { GameDefinitionError, loadGame } from '../dsl/compile';
import { smokeTest } from '../dsl/smoke';
import type { GameEntry } from '../games';
import { type CardRow, mergeCardList, readCardList } from '../cardList';
import { FIX_PROMPT, TEMPLATE, TEMPLATE_FILE_NAME } from '../template';
import { downloadFile } from './download';

interface Props {
  games: GameEntry[];
  onAdd(entry: GameEntry): void;
  onRemove(id: string): void;
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  }
  return <button onClick={copy}>{copied ? 'Copied' : label}</button>;
}

export function UploadPanel({ games, onAdd, onRemove }: Props) {
  const [source, setSource] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const [cardList, setCardList] = useState<{ fileName: string; rows: CardRow[] } | null>(null);
  const [cardListError, setCardListError] = useState('');
  const editor = useRef<HTMLElement>(null);
  const yours = games.filter((g) => !g.builtin);

  function check(text = source, rows = cardList?.rows ?? null) {
    try {
      text = mergeCardList(text, rows);
      const game = loadGame(text);
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
      onAdd({ game, source: text, builtin: false });
    } catch (err) {
      setIssues(err instanceof GameDefinitionError ? err.issues : [err instanceof Error ? err.message : String(err)]);
    }
  }

  function edit(yaml: string) {
    setSource(yaml);
    setIssues([]);
    editor.current?.scrollIntoView({ behavior: 'smooth' });
  }

  async function openFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    setSource(text);
    check(text);
  }

  async function openCardList(file: File | undefined) {
    if (!file) return;
    try {
      setCardList({ fileName: file.name, rows: await readCardList(file) });
      setCardListError('');
    } catch (err) {
      setCardList(null);
      setCardListError(err instanceof Error ? err.message : String(err));
    }
  }

  const fixPrompt = `${FIX_PROMPT}\n${issues.map((i) => `- ${i}`).join('\n')}`;

  return (
    <>
      <section className="card">
        <h2>Game File Template</h2>
        <p className="muted">
          Attach the template to a chat in{' '}
          <a href="https://claude.ai" target="_blank" rel="noreferrer">
            claude.ai
          </a>{' '}
          with your rulebook and card list, and ask Claude to follow it. It tells Claude how to write your game file a step at a time, and
          includes the full file format with three example games.
        </p>
        <div className="actions">
          <button className="primary" onClick={() => downloadFile(TEMPLATE_FILE_NAME, TEMPLATE, 'text/markdown')}>
            Download the template
          </button>
        </div>
      </section>

      <section className="card" ref={editor}>
        <h2>Upload Your Game File</h2>
        <p className="muted">
          Upload the <code>game.yaml</code> Claude wrote, or paste it below, and your card list if the game has one. Each row of the card
          list becomes a card. The game is checked and played in a few test games before it's added. The format is described in{' '}
          <a href="https://github.com/patrickpoulin/cardtester/blob/main/docs/game-format.md" target="_blank" rel="noreferrer">
            docs/game-format.md
          </a>
          .
        </p>
        <label className="stack">
          Game file
          <input
            type="file"
            accept=".yaml,.yml,.txt"
            onChange={(e) => {
              openFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <label className="stack">
          Card list (CSV or Excel, optional)
          <input
            type="file"
            accept=".csv,.tsv,.txt,.xlsx"
            onChange={(e) => {
              openCardList(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        {cardList && (
          <p className="muted small">
            {cardList.fileName}: {cardList.rows.length} {cardList.rows.length === 1 ? 'card' : 'cards'} will be added to the game file.{' '}
            <button className="link" onClick={() => setCardList(null)}>
              Remove
            </button>
          </p>
        )}
        {cardListError && <p className="error">{cardListError}</p>}
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
          <button className="primary" onClick={() => check()} disabled={!source.trim()}>
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
            <div className="actions">
              <CopyButton text={fixPrompt} label="Copy as a prompt for Claude" />
            </div>
          </div>
        )}
      </section>

      {yours.length > 0 && (
        <section className="card">
          <h2>Your games</h2>
          <p className="muted small">Kept in this browser. Download a game to keep a backup or use it in another browser.</p>
          <ul className="game-list">
            {yours.map((g) => (
              <li key={g.game.id}>
                <span>{g.game.name}</span>
                <span className="nowrap">
                  <button className="link" onClick={() => edit(g.source)}>
                    Edit
                  </button>
                  <button className="link" onClick={() => downloadFile(`${g.game.id}.yaml`, g.source, 'text/yaml')}>
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
