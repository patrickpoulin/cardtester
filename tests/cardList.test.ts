import { describe, expect, it } from 'vitest';
import { attrName, CardListError, cardRows, mergeCardList, parseDelimited } from '../src/cardList';
import { loadGame } from '../src/dsl/compile';
import deckBuilder from './fixtures/games/deck-builder.yaml?raw';

describe('card lists', () => {
  it('parses CSV with quotes and guesses TSV', () => {
    expect(parseDelimited('a,b\n"x, ""y""",2\r\n')).toEqual([
      ['a', 'b'],
      ['x, "y"', '2'],
    ]);
    expect(parseDelimited('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('names attributes in camelCase', () => {
    expect(attrName('Casting Cost')).toBe('castingCost');
    expect(attrName('Card Type')).toBe('cardType');
    expect(attrName('ATK')).toBe('atk');
    expect(attrName('2nd Effect')).toBe('_2ndEffect');
  });

  it('turns rows into cards, with placement columns kept apart from attributes', () => {
    const rows = cardRows([
      ['Unique ID', 'Card Type', 'Casting Cost', 'Copies', 'Per Player', 'Text'],
      ['Goblin', 'Companion', '1', '', '4', 'Sneaky'],
      [null, null, null, null, null, null],
      ['Sword', 'Weapon', 2, 3, '', ''],
    ]);
    expect(rows).toEqual([
      { name: 'Goblin', perPlayer: 4, attrs: { cardType: 'Companion', castingCost: 1, text: 'Sneaky' } },
      { name: 'Sword', count: 3, attrs: { cardType: 'Weapon', castingCost: 2 } },
    ]);
  });

  it('reports bad rows', () => {
    expect(() => cardRows([['Name', 'Count'], ['A', 'two']])).toThrow(CardListError);
    expect(() => cardRows([['Name'], ['A'], ['A']])).toThrow(/listed twice/);
  });

  it('merges the list into the game file using the cardList defaults', () => {
    const base = deckBuilder.replace(/^cards:\n/m, 'cardList: { perPlayer: { count: 2, zone: deck } }\ncards:\n');
    const merged = mergeCardList(base, [
      { name: 'Village', count: 5, attrs: { cost: 4 } },
      { name: 'Dragon', attrs: { kind: 'victory', cost: 9, vp: 8 } },
    ]);
    const effectOnly = mergeCardList('cardList: { perPlayer: { count: 2, zone: deck } }\ncards:\n  - name: Dragon\n    onPlay: []\n', [
      { name: 'Dragon', attrs: { cost: 9 } },
    ]);
    expect(effectOnly).toBe('cards:\n  - name: Dragon\n    onPlay: []\n    perPlayer: { count: 2, zone: deck }\n    attrs: { cost: 9 }\n');
    expect(merged).not.toContain('cardList');
    const game = loadGame(merged);
    expect(game).toBeTruthy();
    expect(merged).toMatch(/name: Dragon\n\s+perPlayer: \{ count: 2, zone: deck \}\n\s+attrs: \{ kind: victory, cost: 9, vp: 8 \}/);
    // Village keeps its zone, onPlay effects and other attributes, with the list's count and cost.
    expect(merged).toMatch(/name: Village\n\s+count: 5\n\s+zone: supply\n\s+attrs: \{ kind: action, cost: 4 \}\n\s+onPlay:/);
  });

  it('leaves a file without a card list alone', () => {
    expect(mergeCardList(deckBuilder, null)).toBe(deckBuilder);
  });
});
