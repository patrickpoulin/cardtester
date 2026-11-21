import { useMemo } from 'react';
import { parseGameYaml } from '../dsl/compile';
import { builtinGame, formatOf } from '../deckFormats';
import type { GameEntry } from '../games';

/** The deck's own name, without the game's name or the "(sheet)" marker. */
export function deckLabel(g: GameEntry): string {
  return g.game.name.replace(/^[^:]*:\s*/, '').replace(/\s*\(sheet\)$/, '');
}

interface Props {
  entry: GameEntry;
}

const time = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/** Says which sheet tab the chosen deck comes from, which settings it plays with, and lists its cards. */
export function DeckSource({ entry }: Props) {
  const rules = formatOf(entry.game.id)?.rules ?? entry.source;
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
      return parseGameYaml(rules).vars.shared as Record<string, unknown>;
    } catch {
      return {};
    }
  }, [rules]);
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

  const gameId = formatOf(entry.game.id)?.gameId;
  const gameName = gameId ? builtinGame(gameId).game.name : entry.game.name;
  const where = `Game: ${gameName} (named in your sheet). This deck was read from the "${entry.sheet?.tab ?? ''}" tab${entry.sheet?.fetchedAt ? ` at ${time(entry.sheet.fetchedAt)}` : ''}. After editing the sheet, click Analyze above.`;

  return (
    <div className="deck-source">
      <p>{where}</p>
      <p className="small">
        {changed.length
          ? `Settings from the sheet: ${changed.map(([k, v]) => `${k} ${String(v)} (default ${String(defaults[k])})`).join(', ')}. Everything else is the default.`
          : 'Settings: the sheet uses the default values.'}
      </p>
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
