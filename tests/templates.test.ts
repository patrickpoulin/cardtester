import { readFileSync } from 'node:fs';
import readExcelFile from 'read-excel-file/universal';
import { describe, expect, it } from 'vitest';
import { mergeCardList, readCardList } from '../src/cardList';
import { loadGame, parseGameYaml } from '../src/dsl/compile';
import { smokeTest } from '../src/dsl/smoke';
import { BUILTIN_GAMES } from '../src/games';

const laneClash = BUILTIN_GAMES.find((e) => e.game.id === 'lane-clash')!;
const gameCards: Record<string, unknown>[] = parseGameYaml(laneClash.source).cards.flatMap((c) => ('name' in c ? [{ name: c.name, ...c.attrs }] : []));
const templatePath = (name: string) => new URL(`../public/templates/${name}`, import.meta.url);
const template = (name: string) => new File([readFileSync(templatePath(name))], name);

describe('download templates', () => {
  it('the Excel card list matches the Lane Clash game file', async () => {
    const rows = await readCardList(template('card-list-template.xlsx'));
    expect(rows.map((r) => r.name)).toEqual(gameCards.map((c) => c.name));
    rows.forEach((row, i) => {
      expect(row.perPlayer).toBe(1);
      expect([row.attrs.cost, row.attrs.power]).toEqual([gameCards[i].cost, gameCards[i].power]);
    });
  });

  it('the CSV card list matches the Excel one', async () => {
    expect(await readCardList(template('card-list-template.csv'))).toEqual(await readCardList(template('card-list-template.xlsx')));
  });

  it('the Excel file has the Locations and help sheets after the cards', async () => {
    const sheets = await readExcelFile(readFileSync(templatePath('card-list-template.xlsx')).buffer as ArrayBuffer);
    expect(sheets.map((s) => s.sheet)).toEqual(['Cards', 'Locations', 'How to fill this in']);
  });

  it('uploading Lane Clash with the card list template gives a playable game with the same cards', async () => {
    const merged = mergeCardList(laneClash.source, await readCardList(template('card-list-template.xlsx')));
    const game = loadGame(merged);
    expect(smokeTest(game, 3)).toEqual([]);
    const cards = parseGameYaml(merged).cards.flatMap((c) => ('name' in c ? [c] : []));
    expect(cards.map((c) => c.name)).toEqual(gameCards.map((c) => c.name));
    expect(cards.find((c) => c.name === 'Medic')?.attrs).toMatchObject({ abilityType: 'On Reveal', cost: 2, power: 2 });
  });

  it('the game template documents each section', () => {
    for (const section of ['CARDS', 'ZONES', 'VARIABLES', 'DEFINE', 'SETUP AND TURNS', 'ACTIONS', 'ENDING AND WINNING']) {
      expect(laneClash.source).toContain(`# ${section}`);
    }
  });
});
