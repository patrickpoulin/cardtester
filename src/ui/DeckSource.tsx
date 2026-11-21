import { useMemo } from 'react';
import { parseGameYaml } from '../dsl/compile';
import type { GameEntry } from '../games';

export type DeckOrigin = 'builtin' | 'sheet' | 'uploaded';

export const originOf = (g: GameEntry): DeckOrigin => (g.builtin ? 'builtin' : g.fromSheet ? 'sheet' : 'uploaded');

export const ORIGIN_LABELS: Record<DeckOrigin, string> = {
  builtin: 'Built into the site',
  sheet: 'From your Google Sheet',
  uploaded: 'Uploaded in this browser',
};

/** The deck's own name, without the game's name or the "(sheet)" marker. */
export function deckLabel(g: GameEntry): string {
  if (g.builtin) return 'Original deck';
  return g.game.name.replace(/^[^:]*:\s*/, '').replace(/\s*\(sheet\)$/, '');
}

interface Props {
  entry: GameEntry;
  /** The game's built-in entry, for the default settings. */
  builtin: GameEntry;
}

const time = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/** Says where the chosen deck comes from, which settings it plays with, and lists its cards. */
export function DeckSource({ entry, builtin }: Props) {
  const origin = originOf(entry);
  const cards = useMemo(() => {
    try {
      return parseGameYaml(entry.source).cards.flatMap((c) => {
        if (!('name' in c)) return [];
        const a = (c.attrs ?? {}) as Record<string, unknown>;
        const copies = (c as { perPlayer?: { count?: unknown } }).perPlayer?.count ?? (c as { count?: unknown }).count ?? 1;
        return [{ name: c.name, copies: String(copies), cost: a.cost, power: a.power, text: a.ability ?? a.text ?? '' }];
      });
    } catch {
      return [];
    }
  }, [entry.source]);
  const defaults = useMemo(() => {
    try {
      return parseGameYaml(builtin.source).vars.shared as Record<string, unknown>;
    } catch {
      return {};
    }
  }, [builtin.source]);
  const perPlayer = useMemo(() => {
    try {
      return parseGameYaml(entry.source).cards.some((c) => 'perPlayer' in c);
    } catch {
      return false;
    }
  }, [entry.source]);
  const hasStats = cards.some((c) => c.cost !== undefined || c.power !== undefined);
  const total = cards.reduce((n, c) => n + (Number(c.copies) || 0), 0);
  const changed = Object.entries(entry.sheet?.settings ?? {});

  let where: string;
  if (origin === 'builtin') where = "The deck that comes with the site, played with the default settings. Editing the Google Sheet doesn't change it.";
  else if (origin === 'sheet')
    where = `Read from the "${entry.sheet?.tab ?? ''}" tab of your Google Sheet${entry.sheet?.fetchedAt ? ` at ${time(entry.sheet.fetchedAt)}` : ''}. Click Reload from sheet above after editing it.`;
  else where = 'A deck you uploaded or pasted, kept in this browser and played with the default settings.';

  return (
    <div className={`deck-source deck-source-${origin}`}>
      <p>
        <span className="deck-badge">{ORIGIN_LABELS[origin]}</span> {where}
      </p>
      {origin === 'sheet' && (
        <p className="small">
          {changed.length
            ? `Settings from the sheet: ${changed.map(([k, v]) => `${k} ${String(v)} (default ${String(defaults[k])})`).join(', ')}. Everything else is the default.`
            : 'Settings: the sheet uses the default values.'}
        </p>
      )}
      <details className="source">
        <summary>
          {cards.length} {cards.length === 1 ? 'card' : 'cards'}
          {total !== cards.length ? `, ${total} copies` : ''}
          {perPlayer ? ' in each player\'s deck' : ''}
        </summary>
        <table className="effects">
          <thead>
            <tr>
              <th>Card</th>
              <th>Copies</th>
              {hasStats && <th>Cost</th>}
              {hasStats && <th>Power</th>}
              <th>Text</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => (
              <tr key={c.name}>
                <td className="nowrap">{c.name}</td>
                <td>{c.copies}</td>
                {hasStats && <td>{c.cost === undefined ? '' : String(c.cost)}</td>}
                {hasStats && <td>{c.power === undefined ? '' : String(c.power)}</td>}
                <td>{String(c.text)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
