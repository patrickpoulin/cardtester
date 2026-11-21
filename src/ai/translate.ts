import { z } from 'zod';
import formatGuide from '../../docs/game-format.md?raw';
import type { CardRow } from '../cardList';
import { type AbilityBook, deckGame } from '../deck';
import { GameDefinitionError, parseGameYaml } from '../dsl/compile';
import { smokeTest } from '../dsl/smoke';
import { NOT_SNAP_RULES } from '../games';
import { abilityKey, CODE_FIELDS, type CardAbility } from './abilities';
import { BUILTIN_BOOK } from './builtinBook';

/*
 * Turns card text into Not Snap rules with Claude. The browser calls the Claude API directly with the
 * person's own API key, which stays in their browser. Every translation is test-played before it's
 * used, and kept in the browser by its text, so a text is only sent once and plays the same way in
 * every run until its wording changes.
 */

export const MODEL = 'claude-opus-5-5';
/** Bump when the prompt or the way abilities are spliced in changes, so old translations are redone. */
const VERSION = 1;

// ---------------------------------------------------------------------------------------------
// The browser's store of translations and the API key
// ---------------------------------------------------------------------------------------------

const KEY_STORE = 'cardtester.apiKey';
const BOOK_STORE = `cardtester.abilities.v${VERSION}`;

export function savedApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORE) ?? '';
  } catch {
    return '';
  }
}

export function saveApiKey(key: string) {
  try {
    if (key) localStorage.setItem(KEY_STORE, key);
    else localStorage.removeItem(KEY_STORE);
  } catch {
    // Storage can be off (private windows); the key then lasts until the page closes.
  }
}

function storedAbilities(): CardAbility[] {
  try {
    const raw = localStorage.getItem(BOOK_STORE);
    return raw ? (JSON.parse(raw) as CardAbility[]) : [];
  } catch {
    return [];
  }
}

/** Every translation the browser has: the site's own, then the ones Claude made here. */
export function savedBook(): AbilityBook {
  return new Map([...BUILTIN_BOOK, ...storedAbilities()].map((a) => [abilityKey(a.text), a]));
}

function saveAbilities(list: CardAbility[]) {
  const all = new Map(storedAbilities().map((a) => [abilityKey(a.text), a]));
  for (const a of list) all.set(abilityKey(a.text), a);
  try {
    localStorage.setItem(BOOK_STORE, JSON.stringify([...all.values()]));
  } catch {
    // Not kept; the texts are translated again next time.
  }
}

/** The Ability texts in these decks' rows that have no Effect, each once. */
export function abilityTexts(decks: { rows: CardRow[] }[]): string[] {
  const seen = new Map<string, string>();
  for (const { rows } of decks)
    for (const r of rows) {
      const text = r.attrs.ability;
      if (r.attrs.effect === undefined && typeof text === 'string' && text.trim() && !seen.has(abilityKey(text))) seen.set(abilityKey(text), text.trim());
    }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------------------------
// Checking a translation
// ---------------------------------------------------------------------------------------------

const STARTER: CardRow[] = parseGameYaml(NOT_SNAP_RULES).cards.flatMap((c) =>
  'name' in c ? [{ name: c.name, perPlayer: 1, attrs: { ...((c.attrs ?? {}) as CardRow['attrs']) } }] : [],
);

/**
 * Test-plays the ability: two copies of a card with it are added to the starter deck and a few dozen
 * quick games are played. Returns the problems found (none means it works).
 */
export function checkAbility(ability: CardAbility): string[] {
  const card: CardRow = { name: 'Ability Test', perPlayer: 2, attrs: { cost: 1, power: 2, ability: ability.text } };
  try {
    const game = deckGame(NOT_SNAP_RULES, [...STARTER, card], 'Check', new Map([[abilityKey(ability.text), ability]])).game;
    return smokeTest(game, 40);
  } catch (err) {
    return err instanceof GameDefinitionError ? err.issues : [err instanceof Error ? err.message : String(err)];
  }
}

// ---------------------------------------------------------------------------------------------
// Asking Claude
// ---------------------------------------------------------------------------------------------

const EXAMPLES = `
Examples (text -> fields; fields not shown are empty strings):

"On Reveal: draw 2 cards."
  onReveal: |
    - draw: { from: owner.deck, to: owner.hand, count: "max(0, min(2, handLimit - len(owner.hand)))" }

"On Reveal: your other cards here get +1 Power."
  onReveal: |
    - forEach: { in: "filter(laneOf(owner, lane), c => c.id != self.id)", as: c, do: [ { add: { var: c.power, value: 1 } } ] }

"On Reveal: if your opponent has a card here, +3 Power."
  onReveal: |
    - if: "len(laneOf(opponent(owner), lane)) > 0"
      then:
        - add: { var: self.power, value: 3 }

"On Reveal: destroy the enemy card here with the lowest Power."
  onReveal: |
    - if: "len(laneOf(opponent(owner), lane)) > 0"
      then:
        - move: { card: "minBy(laneOf(opponent(owner), lane), c => c.power)", to: "opponent(owner).destroyed" }

"Ongoing: your other cards here have +1 Power."
  ongoingMine: "l == lane ? len(laneOf(owner, l)) - 1 : 0"

"Ongoing: enemy cards here have -2 Power."
  ongoingTheirs: "l == lane ? -2 * len(laneOf(opponent(owner), l)) : 0"

"Ongoing: +3 Power if this location is full."
  ongoingMine: "l == lane and len(laneOf(owner, l)) >= cardsPerLocation ? 3 : 0"

"Ongoing: your cards at other locations have +1 Power."
  ongoingMine: "l != lane ? len(laneOf(owner, l)) : 0"

"When this is destroyed, draw a card."
  whenDestroyed: |
    - draw: { from: owner.deck, to: owner.hand, count: "max(0, min(1, handLimit - len(owner.hand)))" }

"At the end of your turn, this gains +1 Power."
  endOfTurn: |
    - add: { var: self.power, value: 1 }

"On Reveal: move the weakest enemy card here to another location." (the text doesn't say which: take
the first other location with room)
  onReveal: |
    - if: "len(laneOf(opponent(owner), lane)) > 0 and any([1, 2, 3], x => x != lane and len(laneOf(opponent(owner), x)) < cardsPerLocation)"
      then:
        - forEach:
            in: "[minBy(laneOf(opponent(owner), lane), c => c.power)]"
            as: victim
            do:
              - forEach:
                  in: "[filter([1, 2, 3], x => x != lane and len(laneOf(opponent(owner), x)) < cardsPerLocation)[0]]"
                  as: dest
                  do:
                    - move: { card: victim, to: "laneOf(opponent(owner), dest)" }
                    - set: { var: victim.lane, value: dest }
  (forEach over a one-item list is the way to give a value a name; check lists aren't empty first, as here.)

"Snap: when you play this, you win the game." -> unsupported: "Not Snap has no snapping, so this card plays without its ability." (all code fields empty)
`;

const SYSTEM = `You translate the text of cards in Not Snap, a card game simulator, into its rules language.
Not Snap is a Marvel Snap-style lane battler. Its complete rules file is below, followed by the reference
for the rules language. Each card's text becomes code in five fields, which the simulator splices into
the rules. Translate exactly what the text says, as a careful player would read it.

Names you can use in every field:
- self: the card with the ability. Its fields: self.id, self.name, self.cost, self.power (a number you
  can change with add/set), self.lane (1-3, the location it was played at).
- owner: the player the card belongs to. owner.hand, owner.deck, owner.destroyed, owner.lane1..lane3,
  owner.energy, owner.index. opponent(owner) is the other player.
- lane: the location self is at (1, 2 or 3). laneOf(player, lane) is that player's cards at a location.
- Everything in the rules' vars and define: snapTurn (the turn, 1-6), turns, handLimit,
  cardsPerLocation, forgeBonus, bogPenalty, openLanes, and so on. Locations: 1 Plains, 2 Forge, 3 Bog.
- Inside Ongoing expressions only: l, the location whose power is being added up.

The fields (use an empty string for a field the card doesn't need):
- onReveal: YAML list of effects, run once right after the card is played to its location.
- ongoingMine: an expression: how much power self adds to owner's total at location l while in play
  (usually 0 when l != lane). Don't count self's own printed power; that's already counted.
- ongoingTheirs: an expression: how much self changes the opponent's total at location l.
- whenDestroyed: YAML list of effects, run when self is destroyed. lane is where it was.
- endOfTurn: YAML list of effects, run at the end of each of owner's turns while self is in play.
- summary: one plain sentence saying exactly how the card will play in the simulator, including any
  choice you made where the text was vague (e.g. which card is picked).
- unsupported: if part of the text can't be done with these hooks or the rules (costs that change,
  cubes, snapping, copying abilities, effects in the hand or deck that the rules can't see), say in one
  sentence what is left out; otherwise an empty string. Translate everything that can be done.

Rules for the code:
- Ongoing expressions must not call lanePower, locationsWon or totalPower (they're defined in terms of
  Ongoing, so that would loop), and must be the same whenever they're asked.
- To destroy a card, move it to its owner's destroyed pile: to: "owner.destroyed" for owner's cards,
  "opponent(owner).destroyed" for the opponent's. When Destroyed abilities then run automatically.
- When you move a card to another location, also set its lane: { set: { var: X.lane, value: N } }.
- Respect the location limit (cardsPerLocation) when adding or moving cards to a location, and the hand
  limit (handLimit) when drawing.
- Only these card fields can be changed: power, cost, lane. Don't invent new fields or variables.
- Where the text is vague about which card is affected, choose the most natural reading (usually the
  lowest-Power one for destroying, the highest-Power one for copying, the first in the list otherwise)
  and say so in summary.
- Guard against empty lists before reading an item from them.
${EXAMPLES}
=== The Not Snap rules file ===
${NOT_SNAP_RULES}

=== The rules language reference ===
${formatGuide}`;

const RESULT = z.object({
  cards: z.array(
    z.object({
      text: z.string(),
      summary: z.string(),
      onReveal: z.string(),
      ongoingMine: z.string(),
      ongoingTheirs: z.string(),
      whenDestroyed: z.string(),
      endOfTurn: z.string(),
      unsupported: z.string(),
    }),
  ),
});

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cards'],
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'summary', ...CODE_FIELDS, 'unsupported'],
        properties: Object.fromEntries(['text', 'summary', ...CODE_FIELDS, 'unsupported'].map((k) => [k, { type: 'string' }])),
      },
    },
  },
};

export class TranslateError extends Error {}

type Ask = (prompt: string) => Promise<string>;

/** Sends one request to Claude and returns its JSON text. */
function claudeAsker(apiKey: string): Ask {
  return async (prompt) => {
    // Loaded only when there's something to translate, to keep the site quick to open.
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    let message;
    try {
      message = await client.beta.messages
        .stream({
          model: MODEL,
          max_tokens: 64000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          cache_control: { type: 'ephemeral' },
          system: SYSTEM,
          output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
          messages: [{ role: 'user', content: prompt }],
        })
        .finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new TranslateError('Claude didn\'t accept the API key. Check it in the Claude Console.');
      if (err instanceof Anthropic.PermissionDeniedError) throw new TranslateError('The API key isn\'t allowed to use Claude. Check its workspace in the Claude Console.');
      if (err instanceof Anthropic.RateLimitError) throw new TranslateError('Claude is rate-limiting this API key. Wait a minute and click Analyze again.');
      if (err instanceof Anthropic.APIError) throw new TranslateError(`Claude answered with an error${err.status ? ` (${err.status})` : ''}: ${err.message}`);
      throw new TranslateError(`Couldn't reach Claude: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (message.stop_reason === 'refusal') throw new TranslateError('Claude declined to translate these cards.');
    if (message.stop_reason === 'max_tokens') throw new TranslateError('Claude\'s answer was cut off; try fewer cards at once.');
    const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    return text;
  };
}

function parseAnswer(json: string, texts: string[]): CardAbility[] {
  let parsed;
  try {
    parsed = RESULT.parse(JSON.parse(json));
  } catch {
    throw new TranslateError('Claude\'s answer wasn\'t in the expected form. Click Analyze to try again.');
  }
  // Answers are matched to texts by position, and the text is ours, not Claude's copy of it.
  return texts.map((text, i) => {
    const a = parsed.cards[i];
    if (!a) throw new TranslateError(`Claude skipped "${text}". Click Analyze to try again.`);
    return { ...a, text };
  });
}

const firstAsk = (texts: string[]) =>
  `Translate the text of each of these ${texts.length} cards. Answer with one entry per card, in the same order, with text copied exactly.\n\n` +
  texts.map((t, i) => `${i + 1}. ${t}`).join('\n');

const retryAsk = (failed: { ability: CardAbility; problems: string[] }[]) =>
  `Your translations of these cards failed when the simulator test-played them. Fix each one. Answer with one entry per card, in the same order, with text copied exactly.\n\n` +
  failed
    .map(
      ({ ability, problems }, i) =>
        `${i + 1}. ${ability.text}\nYour translation:\n${JSON.stringify(Object.fromEntries(CODE_FIELDS.map((f) => [f, ability[f]])), null, 2)}\nProblems:\n${problems.map((p) => `- ${p}`).join('\n')}`,
    )
    .join('\n\n');

export interface Translated {
  ability: CardAbility;
  /** Problems test play found; when not empty the card plays without its ability. */
  problems: string[];
}

/**
 * Translates the texts, test-plays each translation, and asks once more for any that failed. Working
 * translations are kept in the browser. `ask` replaces the Claude API (for tests).
 */
export async function translateTexts(texts: string[], apiKey: string, progress?: (note: string) => void, ask: Ask = claudeAsker(apiKey)): Promise<Translated[]> {
  if (!texts.length) return [];
  progress?.(`Asking Claude to translate ${texts.length === 1 ? '1 card text' : `${texts.length} card texts`}…`);
  let results: Translated[] = parseAnswer(await ask(firstAsk(texts)), texts).map((ability) => ({ ability, problems: [] }));
  progress?.('Test-playing the translations…');
  results = results.map((r) => ({ ...r, problems: checkAbility(r.ability) }));

  const failed = results.filter((r) => r.problems.length);
  if (failed.length) {
    progress?.(`Asking Claude to fix ${failed.length === 1 ? '1 translation' : `${failed.length} translations`} that failed test play…`);
    const fixed = parseAnswer(await ask(retryAsk(failed)), failed.map((f) => f.ability.text));
    const byText = new Map(fixed.map((a) => [a.text, { ability: a, problems: checkAbility(a) }]));
    results = results.map((r) => (r.problems.length ? (byText.get(r.ability.text) ?? r) : r));
  }

  saveAbilities(results.filter((r) => !r.problems.length).map((r) => r.ability));
  return results;
}
