import { useRef, useState } from 'react';
import type { SourceFile } from '../compiler/files';
import type { CompileResult, RulesCompiler, Status, Usage } from '../compiler/rulesCompiler';
import { playGame } from '../engine/simulate';
import type { GameEntry } from '../games';
import { loadApiKey } from '../settings';

interface Props {
  onAdd(entry: GameEntry): void;
  onOpenSettings(): void;
  /** Opens a file in the paste-a-game editor for hand fixes. */
  onEdit(yaml: string): void;
}

function statusText(s: Status): string {
  switch (s.step) {
    case 'writing':
      return s.chars ? `Claude is writing the game file… (${s.chars.toLocaleString()} characters so far)` : 'Claude is reading the rules…';
    case 'checking':
      return 'Checking the file and playing test games…';
    case 'fixing':
      return `Fixing ${s.problems === 1 ? 'a problem' : `${s.problems} problems`} found in the file (attempt ${s.attempt} of 3)…`;
  }
}

function sampleTrace(result: CompileResult): string[] {
  const game = result.game!;
  const players = Math.min(game.maxPlayers, Math.max(game.minPlayers, 4));
  const config = { gameId: game.id, numPlayers: players, agents: new Array(players).fill('greedy'), seed: Date.now() % 100_000 };
  return playGame(game, config, 0, true).log;
}

export function RulesUpload({ onAdd, onOpenSettings, onEdit }: Props) {
  const [rulesFiles, setRulesFiles] = useState<File[]>([]);
  const [cardFile, setCardFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CompileResult | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [usage, setUsage] = useState<Usage | null>(null);
  const [trace, setTrace] = useState<string[]>([]);
  const compiler = useRef<RulesCompiler | null>(null);
  const abort = useRef<AbortController | null>(null);

  const running = status !== null;
  const hasKey = loadApiKey() !== '';
  const hasRules = rulesFiles.length > 0 || pasted.trim() !== '';

  async function go(step: (c: RulesCompiler) => Promise<CompileResult>, fresh: boolean) {
    setError('');
    abort.current = new AbortController();
    setStatus({ step: 'writing', chars: 0 });
    try {
      // The Claude SDK and compiler load on first use, keeping them out of the initial page load.
      const [{ RulesCompiler }, { sdkTransport }] = await Promise.all([import('../compiler/rulesCompiler'), import('../compiler/claude')]);
      if (fresh || !compiler.current) {
        compiler.current = new RulesCompiler(sdkTransport(loadApiKey()), setStatus, abort.current.signal);
      }
      const r = await step(compiler.current);
      setResult(r);
      setAnswers(Object.fromEntries(r.questions.map((q) => [q.id, q.assumed])));
      setTrace(r.game ? sampleTrace(r) : []);
    } catch (err) {
      const { describeApiError } = await import('../compiler/claude');
      setError(describeApiError(err));
    } finally {
      setUsage(compiler.current ? { ...compiler.current.usage } : null);
      setStatus(null);
      abort.current = null;
    }
  }

  async function start() {
    setResult(null);
    let rules: SourceFile[];
    let cards: SourceFile | null;
    try {
      const { readSourceFile } = await import('../compiler/files');
      rules = await Promise.all(rulesFiles.map(readSourceFile));
      if (pasted.trim()) rules.push({ name: 'pasted rules', kind: 'text', text: pasted });
      cards = cardFile ? await readSourceFile(cardFile) : null;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    await go((c) => c.start(rules, cards), true);
  }

  const changedAnswers = result?.questions.filter((q) => answers[q.id] !== q.assumed) ?? [];

  return (
    <>
      <section className="card">
        <h2>Upload a game</h2>
        <p className="muted">
          Add the rulebook and, if you have one, a card list. Claude writes a game file, test-plays it, and asks about anything the rules leave
          unclear. It usually takes a minute or two.
        </p>
        {!hasKey && (
          <p className="notice">
            This step uses your Claude API key.{' '}
            <button className="link inline" onClick={onOpenSettings}>
              Add it under Settings
            </button>{' '}
            first.
          </p>
        )}
        <div className="form-grid wide">
          <label>
            Rules (PDF, Word or text)
            <input type="file" multiple accept=".pdf,.docx,.txt,.md" disabled={running} onChange={(e) => setRulesFiles([...(e.target.files ?? [])])} />
          </label>
          <label>
            Card list (optional: Excel, CSV or text)
            <input type="file" accept=".xlsx,.csv,.tsv,.txt,.md" disabled={running} onChange={(e) => setCardFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        <details className="source">
          <summary>Or paste the rules as text</summary>
          <textarea rows={8} value={pasted} disabled={running} onChange={(e) => setPasted(e.target.value)} placeholder="Paste the rules here…" />
        </details>
        <div className="actions">
          <button className="primary" onClick={start} disabled={running || !hasKey || !hasRules}>
            Write the game file with Claude
          </button>
          {running && <button onClick={() => abort.current?.abort()}>Stop</button>}
        </div>
        {status && (
          <p className="status" role="status">
            <span className="spinner" aria-hidden="true" /> {statusText(status)}
          </p>
        )}
        {error && <p className="error">{error}</p>}
        {usage && !running && (
          <p className="muted small">
            Claude usage so far: {(usage.inputTokens + usage.cachedInputTokens).toLocaleString()} input tokens (
            {usage.cachedInputTokens.toLocaleString()} from cache, which costs less) and {usage.outputTokens.toLocaleString()} output tokens.
          </p>
        )}
      </section>

      {result && (
        <section className="card">
          <h2>{result.game ? result.game.name : 'The game file needs fixing'}</h2>
          <p>{result.summary}</p>
          {result.game ? (
            <p className="ok">✓ The file is valid and played test games at every player count without problems.</p>
          ) : (
            <div className="error">
              <p>Claude couldn't fix every problem. You can fix the rest by hand in the editor below, or answer the questions and rebuild.</p>
              <ul className="issues">
                {result.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          {result.questions.length > 0 && (
            <>
              <h3>Questions about the rules</h3>
              <p className="muted small">The file currently uses the selected answers. Change any that are wrong, then rebuild.</p>
              {result.questions.map((q) => (
                <fieldset key={q.id} className="question" disabled={running}>
                  <legend>{q.question}</legend>
                  {q.options.map((opt) => (
                    <label key={opt} className="radio">
                      <input type="radio" name={q.id} checked={answers[q.id] === opt} onChange={() => setAnswers({ ...answers, [q.id]: opt })} />
                      {opt}
                    </label>
                  ))}
                </fieldset>
              ))}
            </>
          )}

          <div className="actions">
            {result.game && (
              <button className="primary" disabled={running} onClick={() => onAdd({ game: result.game!, source: result.yaml, builtin: false })}>
                Add to my games
              </button>
            )}
            {result.questions.length > 0 && (
              <button disabled={running || changedAnswers.length === 0} onClick={() => go((c) => c.answer(result.questions, answers), false)}>
                Rebuild with my answers
              </button>
            )}
            <button disabled={running} onClick={() => onEdit(result.yaml)}>
              Edit the file by hand
            </button>
          </div>

          {trace.length > 0 && (
            <details className="source">
              <summary>Watch a sample game ({trace.length} moves)</summary>
              <ol className="trace">
                {trace.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ol>
            </details>
          )}
          <details className="source">
            <summary>View the game file</summary>
            <pre>{result.yaml}</pre>
          </details>
        </section>
      )}
    </>
  );
}
