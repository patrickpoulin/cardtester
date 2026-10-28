import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cardRows, parseDelimited, readCardList } from '../src/cardList';
import { parseGameYaml } from '../src/dsl/compile';
import { smokeTest } from '../src/dsl/smoke';
import { DeckError, deckCsv, deckGame, isDeckGame } from '../src/deck';
import { BUILTIN_GAMES, NOT_SNAP_RULES } from '../src/games';

const starterCsv = deckCsv(NOT_SNAP_RULES);
const starterCards = parseGameYaml(NOT_SNAP_RULES).cards;
const rows = (csv: string) => cardRows(parseDelimited(csv));

describe('Not Snap decks', () => {
  it('the site has Not Snap and Rascally Raccoons', () => {
    expect(BUILTIN_GAMES.map((e) => e.game.id)).toEqual(['not-snap', 'rascally-raccoons']);
  });

  it('the starter deck round-trips through the deck template into the same cards', () => {
    const entry = deckGame(NOT_SNAP_RULES, rows(starterCsv), 'Starter');
    expect(entry.game.id).toBe('not-snap-starter');
    expect(entry.game.name).toBe('Not Snap: Starter');
    expect(isDeckGame(entry.game.id)).toBe(true);
    expect(parseGameYaml(entry.source).cards).toEqual(starterCards);
    expect(smokeTest(entry.game, 3)).toEqual([]);
  });

  it('the Excel template matches the starter deck', async () => {
    const file = new File([readFileSync(new URL('../public/templates/deck-template.xlsx', import.meta.url))], 'deck-template.xlsx');
    expect(await readCardList(file)).toEqual(rows(starterCsv));
  });

  it('replaces the starter cards with the uploaded deck, one copy each by default and Count as copies per player', () => {
    const entry = deckGame(NOT_SNAP_RULES, rows('Name,Count,Cost,Power,Effect,Amount\nImp,3,1,1,draw,1\nOgre,,4,7,,\n'), 'Tiny');
    expect(parseGameYaml(entry.source).cards).toEqual([
      { name: 'Imp', perPlayer: { count: 3, zone: 'deck' }, attrs: { cost: 1, power: 1, effect: 'draw', amount: 1 } },
      { name: 'Ogre', perPlayer: { count: 1, zone: 'deck' }, attrs: { cost: 4, power: 7 } },
    ]);
    expect(smokeTest(entry.game, 3)).toEqual([]);
  });

  it('counts an empty Cost or Power as 0', () => {
    const entry = deckGame(NOT_SNAP_RULES, rows('Name,Cost,Power\nSpell,2,\nLegend,,\n'), 'x');
    expect(parseGameYaml(entry.source).cards.map((c) => ('attrs' in c ? c.attrs : undefined))).toEqual([
      { cost: 2, power: 0 },
      { cost: 0, power: 0 },
    ]);
  });

  it('reads Casting Cost, Attack and Text as Cost, Power and Ability', () => {
    const entry = deckGame(NOT_SNAP_RULES, rows('Unique ID,Card Type,Casting Cost,Attack,Text\nImp,Companion,2,3,Hits hard\n'), 'x');
    expect(parseGameYaml(entry.source).cards.map((c) => ('attrs' in c ? c.attrs : undefined))).toEqual([
      { cardType: 'Companion', cost: 2, power: 3, ability: 'Hits hard' },
    ]);
  });

  it('accepts effect names in any case and reports bad rows together', () => {
    expect(() => deckGame(NOT_SNAP_RULES, rows('Name,Cost,Power,Effect,Amount\nA,1,1,ONGOING boost,2\n'), 'x')).not.toThrow();
    try {
      deckGame(NOT_SNAP_RULES, rows('Name,Cost,Power,Effect,Amount\nA,1,2.5,,\nB,1,1,Explode,2\nC,1,1,Draw,\n'), 'x');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DeckError);
      expect((err as DeckError).issues).toEqual([
        'A: Power must be a whole number',
        'B: unknown Effect "Explode"; use one of Draw, Boost Here, Weaken Here, Contested, Alone, Ongoing Boost, or leave it empty',
        'C: an Effect needs a whole-number Amount',
      ]);
    }
  });
});
