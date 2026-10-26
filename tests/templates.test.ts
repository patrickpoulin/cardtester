import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readSourceFile } from '../src/compiler/files';
import { parseGameYaml } from '../src/dsl/compile';
import { BUILTIN_GAMES } from '../src/games';

const laneClash = BUILTIN_GAMES.find((e) => e.game.id === 'lane-clash')!;
const gameCards: Record<string, unknown>[] = parseGameYaml(laneClash.source).cards.flatMap((c) => ('name' in c ? [{ name: c.name, ...c.attrs }] : []));
const template = (name: string) => new File([readFileSync(new URL(`../public/templates/${name}`, import.meta.url))], name);

describe('download templates', () => {
  it('the Excel card list matches the Lane Clash game file', async () => {
    const file = await readSourceFile(template('card-list-template.xlsx'));
    if (file.kind !== 'text') throw new Error('expected text');
    const [cards, locations, help] = file.text.split('\n\nSheet: ');
    const rows = cards.split('\n').slice(2); // "Sheet: Cards", header
    expect(rows.map((r) => r.split(',')[0])).toEqual(gameCards.map((c) => c.name));
    for (const [i, row] of rows.entries()) {
      const [, , cost, power] = row.split(',');
      expect([Number(cost), Number(power)]).toEqual([gameCards[i].cost, gameCards[i].power]);
    }
    expect(locations).toMatch(/^Locations\nlocation,effect\nPlains,/);
    expect(help).toMatch(/^How to fill this in\n/);
  });

  it('the CSV card list matches the Excel one', async () => {
    const csv = readFileSync(new URL('../public/templates/card-list-template.csv', import.meta.url), 'utf8');
    const xlsx = await readSourceFile(template('card-list-template.xlsx'));
    if (xlsx.kind !== 'text') throw new Error('expected text');
    expect(xlsx.text.startsWith(`Sheet: Cards\n${csv}`)).toBe(true);
  });

  it('the game template documents each section', () => {
    for (const section of ['CARDS', 'ZONES', 'VARIABLES', 'DEFINE', 'SETUP AND TURNS', 'ACTIONS', 'ENDING AND WINNING']) {
      expect(laneClash.source).toContain(`# ${section}`);
    }
  });
});
