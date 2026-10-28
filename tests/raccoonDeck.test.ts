import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cardRows, parseDelimited, readCardList } from '../src/cardList';
import { DeckError } from '../src/deck';
import { DECK_FORMATS, formatOf, gamesOfKind, pastedCardRows } from '../src/deckFormats';
import { parseGameYaml } from '../src/dsl/compile';
import { smokeTest } from '../src/dsl/smoke';
import { Rng } from '../src/engine/rng';
import { playGame } from '../src/engine/simulate';
import { BUILTIN_GAMES, RASCALLY_RACCOONS_RULES as RULES } from '../src/games';
import { isRaccoonDeck, raccoonDeckCsv, raccoonDeckGame } from '../src/raccoonDeck';

const rows = (csv: string) => cardRows(parseDelimited(csv));
const originalCsv = raccoonDeckCsv(RULES, RULES);
const originalCards = parseGameYaml(RULES).cards;

// The designer's card list as it was shared: Card Name, Text, Copies and no Effect column.
const designerList = `Card Name\tText\tCopies
Percy the Dog\tYou win.\t1
Rascally Raccoon\tPlace it face up.\t5
Tripped Up\t\t3
Rained out\t\t3
Thieves!\t\t3
Animal Control\t\t3
Late trash pickup\t\t3
Raccoon Electric Team\t\t3
Spies!\t\t5
Farmer's Almanac\t\t5
Dog Treats\t\t5
Wind Storm\t\t3
Barbeque\t\t3
Tasty Garbage\t\t3
Midnight Postman\t\t10
Fair Trade\t\t10
Bumper Crop\t\t10
Missing tools\t\t6
`;

describe('Rascally Raccoons', () => {
  const game = BUILTIN_GAMES.find((e) => e.game.id === 'rascally-raccoons')!.game;

  it('deals 6 cards each with no Raccoon in a starting hand, and Percy in exactly one hand', () => {
    for (let seed = 0; seed < 20; seed++) {
      const state = game.setup(4, new Rng(seed)) as { players: { hand: { name: string }[] }[]; shared: Record<string, unknown[]> };
      const hands = state.players.map((p) => p.hand);
      // The first player hasn't drawn yet, so every hand still has 6 cards.
      expect(hands.map((h) => h.length)).toEqual([6, 6, 6, 6]);
      expect(hands.flat().filter((c) => c.name === 'Rascally Raccoon')).toEqual([]);
      expect(hands.flat().filter((c) => c.name === 'Percy the Dog')).toHaveLength(1);
      expect(state.shared.deck).toHaveLength(84 - 24);
    }
  });

  it('every game ends with all Raccoons revealed and the holder of Percy winning', () => {
    for (const n of [2, 4, 6]) {
      const config = { gameId: game.id, numPlayers: n, agents: new Array(n).fill('greedy'), seed: 3 };
      for (let i = 0; i < 30; i++) {
        const { record } = playGame(game, config, i);
        expect(record.hitActionLimit).toBe(false);
        expect(record.winners).toHaveLength(1);
        expect(record.scores[record.winners[0]]).toBe(1);
      }
    }
  });

  it('names chosen players in the move log', () => {
    const config = { gameId: game.id, numPlayers: 3, agents: ['greedy', 'greedy', 'greedy'], seed: 1 };
    const log = Array.from({ length: 10 }, (_, i) => playGame(game, config, i, true).log).flat();
    expect(log.some((line) => /\(target: Player [1-3]\)/.test(line))).toBe(true);
    expect(log.some((line) => line.includes('[object Object]'))).toBe(false);
  });
});

describe('Rascally Raccoons decks', () => {
  it('the original card list round-trips through the deck template', () => {
    const entry = raccoonDeckGame(RULES, rows(originalCsv), 'Original');
    expect(entry.game.id).toBe('rascally-raccoons-original');
    expect(entry.game.name).toBe('Rascally Raccoons: Original');
    expect(isRaccoonDeck(entry.game.id)).toBe(true);
    expect(parseGameYaml(entry.source).cards).toEqual(originalCards);
    expect(entry.game.maxPlayers).toBe(6);
  });

  it('the Excel template matches the original card list', async () => {
    const file = new File([readFileSync(new URL('../public/templates/rascally-raccoons-deck-template.xlsx', import.meta.url))], 'x.xlsx');
    expect(await readCardList(file)).toEqual(rows(originalCsv));
  });

  it("reads the designer's own list, without an Effect column", () => {
    const entry = raccoonDeckGame(RULES, cardRows(parseDelimited(designerList)), 'Designer');
    const cards = parseGameYaml(entry.source).cards;
    expect(cards).toHaveLength(18);
    expect(cards[0]).toEqual({ name: 'Percy the Dog', count: 1, attrs: { effect: 'percy', text: 'You win.' } });
    expect(cards[4]).toEqual({ name: 'Thieves!', count: 3, attrs: { effect: 'thieves' } });
    expect(smokeTest(entry.game, 3)).toEqual([]);
  });

  it('plays renamed and new cards by their Effect, and allows fewer players with a small deck', () => {
    const entry = raccoonDeckGame(
      RULES,
      rows('Card Name,Copies,Effect\nPercy,,percy\nRaccoon,3,Rascally Raccoon\nPickpocket,8,midnight postman\nHaul,6,Bumper Crop\nBBQ,2,barbeque\n'),
      'Small',
    );
    expect(entry.game.maxPlayers).toBe(2);
    expect(smokeTest(entry.game, 5)).toEqual([]);
  });

  it('reports bad rows together', () => {
    try {
      raccoonDeckGame(RULES, rows('Card Name,Copies,Effect,Per Player\nMystery,2,,\nOdd,1,Explode,\nPercy the Dog,1,,2\n'), 'x');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DeckError);
      const issues = (err as DeckError).issues;
      expect(issues[0]).toMatch(/^Mystery: not a card from the Rascally Raccoons list; add an Effect column/);
      expect(issues[1]).toMatch(/^Odd: unknown Effect "Explode"/);
      expect(issues.slice(2)).toEqual([
        'Percy the Dog: Rascally Raccoons has one shared deck; use Copies instead of Per Player',
        'The deck needs at least one Rascally Raccoon card',
        'The deck needs at least 11 cards besides Percy and the Raccoons to deal 6 cards to 2 players; it has 3',
      ]);
    }
  });
});

describe('Deck formats and pasted rows', () => {
  it('finds the game a deck belongs to', () => {
    expect(formatOf('not-snap')?.gameId).toBe('not-snap');
    expect(formatOf('not-snap-my-deck')?.gameId).toBe('not-snap');
    expect(formatOf('rascally-raccoons-small')?.gameId).toBe('rascally-raccoons');
    expect(formatOf('crazy-eights')).toBeUndefined();
    expect(gamesOfKind(BUILTIN_GAMES, 'rascally-raccoons').map((g) => g.game.id)).toEqual(['rascally-raccoons']);
  });

  it('reads pasted spreadsheet rows with a header', () => {
    expect(pastedCardRows(designerList, DECK_FORMATS[1].columns)).toEqual(cardRows(parseDelimited(designerList)));
  });

  it("reads pasted rows without a header in the template's column order", () => {
    const notSnap = DECK_FORMATS[0];
    expect(pastedCardRows('Imp\t2\t1\t1\tDraw\t1\t"Draws a card"\nOgre\t\t4\t7\n', notSnap.columns)).toEqual([
      { name: 'Imp', perPlayer: 2, attrs: { cost: 1, power: 1, effect: 'Draw', amount: 1, ability: 'Draws a card' } },
      { name: 'Ogre', attrs: { cost: 4, power: 7 } },
    ]);
    expect(pastedCardRows('Fair Trade\tSwap a card\t4\n', DECK_FORMATS[1].columns)).toEqual([
      { name: 'Fair Trade', count: 4, attrs: { text: 'Swap a card' } },
    ]);
  });

  it('rejects an empty paste', () => {
    expect(() => pastedCardRows('  \n\t\n', DECK_FORMATS[0].columns)).toThrow('Nothing was pasted');
  });
});
