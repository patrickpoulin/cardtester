import { useState } from 'react';
import { loadApiKey, saveApiKey } from '../settings';

export function SettingsPanel() {
  const [key, setKey] = useState(loadApiKey);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  function save() {
    const stored = saveApiKey(key.trim());
    setStatus(
      stored
        ? { kind: 'ok', text: key.trim() ? 'Saved in this browser.' : 'Key removed.' }
        : { kind: 'error', text: "This browser won't let the page store data (private window?). The key will be forgotten when you leave." },
    );
  }

  async function test() {
    setTesting(true);
    setStatus({ kind: 'info', text: 'Checking…' });
    // Loaded on demand so the Claude SDK isn't part of the initial page load.
    const { testApiKey } = await import('../compiler/claude');
    const result = await testApiKey(key.trim());
    setStatus(result.ok ? { kind: 'ok', text: 'The key works.' } : { kind: 'error', text: result.message });
    setTesting(false);
  }

  return (
    <section className="card">
      <h2>Claude API key</h2>
      <p className="muted">
        Claude reads your uploaded rules and turns them into a playable game. Simulations themselves run on your computer and don't use the key.
      </p>
      <label className="stack">
        API key
        <input type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} />
      </label>
      <div className="actions">
        <button className="primary" onClick={save}>
          Save
        </button>
        <button onClick={test} disabled={!key.trim() || testing}>
          Test key
        </button>
      </div>
      {status && <p className={status.kind === 'error' ? 'error' : status.kind === 'ok' ? 'ok' : 'muted'}>{status.text}</p>}
      <p className="muted small">
        Your key is stored only in this browser and sent only to api.anthropic.com. It is never uploaded to this site or saved in the repository. Get a key
        at console.anthropic.com.
      </p>
    </section>
  );
}
