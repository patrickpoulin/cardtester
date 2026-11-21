import { describe, expect, it } from 'vitest';
import { DECK_FORMATS } from '../src/deckFormats';
import { parseGameYaml } from '../src/dsl/compile';
import { NOT_SNAP_RULES } from '../src/games';
import { applySettings, fetchSheetTabs, sheetFormat, sheetGames, sheetIdFromLink, tabCsvUrl, type SheetTabs } from '../src/sheet';

const notSnap = DECK_FORMATS.find((f) => f.gameId === 'not-snap')!;
const ID = '1Q9TuZoHzV5pTuSW08j5A92Ff4kPy2JkAq-xesGCp1x8';

// Google's query endpoint quotes every cell, as here.
const q = (rows: (string | number)[][]) => rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n') + '\n';

const DECKS = q([
  ['Deck name', 'Tab', 'Default'],
  ['Starter', 'Starter Deck', 'TRUE'],
]);
const SETTINGS = q([
  ['Setting', 'Value', 'What it does'],
  ['openingHand', 4, ''],
  ['turns', 7, ''],
  ['energyPerTurn', 'turn number', ''],
  ['locationsToWin', 2, ''],
]);
const STARTER = q([
  ['Name', 'Per Player', 'Cost', 'Power', 'Effect', 'Amount', 'Ability'],
  ['Lantern Scout', 1, 1, 1, 'Draw', 1, 'On Reveal: draw a card.'],
  ['Rookie Guard', 1, 2, 3, '', '', ''],
  ['Shadow Thief', 1, 2, 1, 'Contested', 3, ''],
  ['Archivist', 1, 3, 2, 'Draw', 2, ''],
  ['Standard Bearer', 1, 3, 3, 'Ongoing Boost', 1, ''],
  ['Storm Caller', 1, 4, 4, 'Weaken Here', 2, ''],
  ['War Drummer', 1, 4, 4, 'Boost Here', 2, ''],
  ['Warlord', 1, 5, 6, 'Ongoing Boost', 2, ''],
  ['Elder Dragon', 1, 6, 12, '', '', ''],
  ['Siege Colossus', 1, 6, 8, 'Weaken Here', 3, ''],
]);
const TABS: SheetTabs = { Decks: DECKS, Settings: SETTINGS, 'Starter Deck': STARTER };

describe('Google Sheet decks', () => {
  it('finds the sheet id in a link', () => {
    expect(sheetIdFromLink(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=drivesdk`)).toBe(ID);
    expect(sheetIdFromLink(ID)).toBe(ID);
    expect(sheetIdFromLink('https://example.com/nope')).toBeNull();
    expect(tabCsvUrl(ID, 'Starter Deck')).toContain('sheet=Starter%20Deck');
  });

  it('takes the game from the Decks tab, or from the deck columns', () => {
    expect(sheetFormat(TABS).gameId).toBe('not-snap');
    const raccoonDecks = q([['Game', 'Deck name', 'Tab'], ['Rascally Raccoons', 'Designer', 'Designer Deck']]);
    expect(sheetFormat({ Decks: raccoonDecks }).gameId).toBe('rascally-raccoons');
    const guessed = q([['Card Name', 'Text', 'Copies', 'Effect'], ['Percy the Dog', '', 1, '']]);
    expect(sheetFormat({ Decks: q([['Deck name', 'Tab'], ['D', 'D']]), D: guessed }).gameId).toBe('rascally-raccoons');
    expect(() => sheetFormat({ Decks: q([['Game', 'Deck name', 'Tab'], ['Hearts', 'D', 'D']]) })).toThrow('isn\'t one Card Tester knows');
  });

  it('builds a deck with the sheet settings', () => {
    const { games, issues, notes } = sheetGames(notSnap, TABS);
    expect(issues).toEqual([]);
    expect(notes[0]).toContain('energyPerTurn, locationsToWin');
    expect(games.map((g) => g.game.name)).toEqual(['Not Snap: Starter (sheet)']);
    expect(games[0].fromSheet).toBe(true);
    const spec = parseGameYaml(games[0].source);
    expect(spec.vars.shared).toMatchObject({ openingHand: 4, turns: 7, handLimit: 7 });
    expect(spec.cards).toHaveLength(10);
  });

  it('only lets the sheet change the game\'s settings', () => {
    const { games, notes } = sheetGames(notSnap, { ...TABS, Settings: q([['Setting', 'Value'], ['snapTurn', 3], ['turns', 5]]) });
    expect(parseGameYaml(games[0].source).vars.shared).toMatchObject({ snapTurn: 1, turns: 5 });
    expect(games[0].sheet?.settings).toEqual({ turns: 5 });
    expect(notes[0]).toContain('snapTurn');
  });

  it('does not read a tab without a card name column as a deck', () => {
    const readMe = q([['Not Snap: example sheet'], ['Use File > Make a copy']]);
    const { games, issues } = sheetGames(notSnap, { Decks: DECKS, Settings: SETTINGS, 'Starter Deck': readMe });
    expect(games).toEqual([]);
    expect(issues).toContain('Starter: there\'s no tab named "Starter Deck"');
  });

  it('keeps the default for a setting with a bad value', () => {
    const { rules, issues } = applySettings(NOT_SNAP_RULES, q([['Setting', 'Value'], ['turns', 'six']]));
    expect(issues[0]).toContain('turns must be a number');
    expect(parseGameYaml(rules).vars.shared.turns).toBe(6);
  });

  it('leaves out a deck with problems and says why', () => {
    const bad = q([
      ['Name', 'Cost', 'Power', 'Effect', 'Amount'],
      ['Imp', 1, 1, 'Teleport', 1],
    ]);
    const decks = q([
      ['Deck name', 'Tab'],
      ['Starter', 'Starter Deck'],
      ['Broken', 'Broken'],
      ['Missing', 'Nowhere'],
    ]);
    // Google sends the first tab for a tab name it doesn't know.
    const { games, issues } = sheetGames(notSnap, { Decks: decks, 'Starter Deck': STARTER, Broken: bad, Nowhere: decks });
    expect(games).toHaveLength(1);
    expect(issues.some((i) => i.startsWith('Broken: Imp: unknown Effect "Teleport"'))).toBe(true);
    expect(issues).toContain('Missing: there\'s no tab named "Nowhere"');
  });

  it('reads the tabs the Decks tab lists', async () => {
    const asked: string[] = [];
    const tabs = await fetchSheetTabs(ID, async (url) => {
      const tab = decodeURIComponent(/sheet=([^&]+)/.exec(url)![1]);
      asked.push(tab);
      return { ok: true, status: 200, text: async () => TABS[tab] };
    });
    expect(asked).toEqual(['Decks', 'Settings', 'Starter Deck']);
    expect(Object.keys(tabs)).toEqual(['Decks', 'Settings', 'Starter Deck']);
  });

  it('explains a sheet that is not shared', async () => {
    await expect(fetchSheetTabs(ID, async () => ({ ok: true, status: 200, text: async () => '<!doctype html><html>Sign in' }))).rejects.toThrow(
      'Anyone with the link can view',
    );
  });
});
