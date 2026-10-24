import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UnsupportedFileError, readSourceFile, spreadsheetToText } from '../src/compiler/files';

const fixture = (name: string) => {
  const bytes = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return new File([bytes], name);
};

describe('card list uploads', () => {
  it('reads every sheet of an Excel file as CSV text', async () => {
    const file = await readSourceFile(fixture('cards.xlsx'));
    expect(file).toEqual({
      name: 'cards.xlsx',
      kind: 'text',
      text: 'Sheet: Cards\nname,count,cost,text\nDragon,2,5,"Deal 3 damage, then draw a card"\nKnight,6,2,Guard\n\nSheet: Tokens\nname,count\nGold,20\n',
    });
  });

  it('formats cells and skips empty rows and sheets', () => {
    expect(
      spreadsheetToText([
        { sheet: 'Cards', data: [['name', 'released', 'foil'], ['Ace', new Date('2026-03-01T00:00:00Z'), true], [null, '', null], ['Say "hi"', null, false]] },
        { sheet: 'Empty', data: [[null]] },
      ]),
    ).toBe('name,released,foil\nAce,2026-03-01,true\n"Say ""hi""",,false\n');
  });

  it('explains which spreadsheet formats need converting', async () => {
    await expect(readSourceFile(new File(['x'], 'cards.xls'))).rejects.toThrow(UnsupportedFileError);
    await expect(readSourceFile(new File(['x'], 'cards.numbers'))).rejects.toThrow(/\.xlsx or CSV/);
  });
});
