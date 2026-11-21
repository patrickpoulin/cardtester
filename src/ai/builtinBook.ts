import type { CardAbility } from './abilities';

/*
 * Translations that come with the site, for the wording the example sheets use, so the examples play
 * fully without an API key. Written and checked by hand (tests/translate.test.ts); a translation
 * from Claude for the same text is never needed.
 */

const blank = { onReveal: '', ongoingMine: '', ongoingTheirs: '', whenDestroyed: '', endOfTurn: '', unsupported: '' };
const n = (k: number) => (k === 1 ? 'a card' : `${k} cards`);

const draw = (k: number): CardAbility => ({
  ...blank,
  text: `On Reveal: draw ${n(k)}.`,
  summary: `When played, its owner draws ${n(k)} (not beyond the hand limit).`,
  onReveal: `- draw: { from: owner.deck, to: owner.hand, count: "max(0, min(${k}, handLimit - len(owner.hand)))" }`,
});
const boost = (k: number): CardAbility => ({
  ...blank,
  text: `On Reveal: your other cards here get +${k} power.`,
  summary: `When played, each of its owner's other cards at this location gets +${k} Power.`,
  onReveal: `- forEach: { in: "filter(laneOf(owner, lane), c => c.id != self.id)", as: c, do: [ { add: { var: c.power, value: ${k} } } ] }`,
});
const weaken = (k: number): CardAbility => ({
  ...blank,
  text: `On Reveal: enemy cards here get -${k} power.`,
  summary: `When played, each enemy card at this location gets -${k} Power.`,
  onReveal: `- forEach: { in: "laneOf(opponent(owner), lane)", as: c, do: [ { add: { var: c.power, value: -${k} } } ] }`,
});
const contested = (k: number): CardAbility => ({
  ...blank,
  text: `On Reveal: if your opponent has a card here, +${k} power.`,
  summary: `When played, it gets +${k} Power if the opponent has a card at this location.`,
  onReveal: `- if: "len(laneOf(opponent(owner), lane)) > 0"\n  then:\n    - add: { var: self.power, value: ${k} }`,
});
const alone = (k: number): CardAbility => ({
  ...blank,
  text: `On Reveal: if this is your only card here, +${k} power.`,
  summary: `When played, it gets +${k} Power if it's its owner's only card at this location.`,
  onReveal: `- if: "len(laneOf(owner, lane)) == 1"\n  then:\n    - add: { var: self.power, value: ${k} }`,
});
const aura = (k: number): CardAbility => ({
  ...blank,
  text: `Ongoing: your other cards here have +${k} power.`,
  summary: `While in play, each of its owner's other cards at this location has +${k} Power.`,
  ongoingMine: `l == lane ? ${k} * (len(laneOf(owner, l)) - 1) : 0`,
});

const amounts = [1, 2, 3, 4];

export const BUILTIN_BOOK: CardAbility[] = [draw, boost, weaken, contested, alone, aura].flatMap((make) => amounts.map(make));

