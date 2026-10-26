import formatReference from '../docs/game-format.md?raw';
import crazyEights from './games/crazy-eights.yaml?raw';
import deckBuilder from './games/deck-builder.yaml?raw';
import hearts from './games/hearts.yaml?raw';

/*
 * What a designer gives Claude (in claude.ai, outside this site) to have it write a game.yaml: a
 * template file to attach alongside their rules and card list.
 */

export const TEMPLATE_FILE_NAME = 'card-tester-template.md';

export const TEMPLATE = `# Card Tester game file template

This file is for Claude. It explains how to turn a card game's rulebook and card list into a
\`game.yaml\` file for Card Tester, a tool that plays a game thousands of times to measure balance,
length and fairness. The person you're working with is usually the game's designer, and the
statistics they get are only as good as the file you write.

## How to work

The designer uploads two things to Card Tester: the game file you write, and their card list
(CSV or Excel) as a separate file. Card Tester turns each row of the card list into a card, so
**don't copy the card list into the game file.** The "Card lists" part of the format reference
below explains how rows become cards and how their columns are named.

Build the file in steps, so that no single reply has too much to do:

1. **Core rules first.** Model the game from the rulebook. Add a \`cardList\` section saying where
   listed cards go, and use the card list's column names (in camelCase) for card attributes in
   expressions, so the real cards play from the start. If there is no card list, write the cards
   entries yourself.
2. **Card effects in batches.** When asked, go through the card list about 40 rows at a time and
   add a cards entry, with just the card's exact name and its \`onPlay\` effects, for each card
   whose text needs one, plus any rules those effects need.
3. **Fixes.** When the designer pastes problems reported by Card Tester, fix every one.

In every reply:

- Start with two to five plain sentences for the designer: what you modelled, and every
  simplification or approximation they should know about.
- If the rules leave something open that would change how the game plays (what happens when the
  deck runs out, tie-breakers, whether a player may pass, timing of an effect), pick the most
  natural reading, write the file that way, and list it as a question with the answer you assumed.
  Ask nothing when the rules are clear, and never more than eight questions.
- Then give the **complete** file in one \`yaml\` code block. Never a fragment or a diff. If the
  file is too long for one reply, stop at the end of a top-level section and say so; the designer
  will ask you to continue.

## Modelling rules

- Follow the format reference below exactly. Use only the fields, effects and built-in functions
  it documents; anything else fails validation. The example games are complete, working files and
  good models for structure and style.
- Model the rules as written. Card text overrides the rules where the rulebook says so.
- Only the current player acts in Card Tester: there are no response windows, interrupts or
  priority. Turn decisions another player makes during someone else's turn (blocking, counters,
  defensive abilities) into automatic rules with a sensible fixed choice, and say so.
- Features the format can't model, such as simultaneous secret choices, real-time play,
  negotiation or dice, must be approximated (for example, resolve simultaneous choices in turn
  order). Explain each approximation.
- Deck building (sideboards, mulligans, point budgets) usually isn't modelled. Give each player a
  fixed test deck and say how you chose it. With a card list, decks come from its \`Count\` or
  \`Per Player\` column and the \`cardList\` defaults; if the list has neither column, tell the
  designer which one to add and what to put in it.
- Every situation that can arise must leave the current player at least one legal action, and the
  game must always end. Add a pass action and a turn limit where needed.
- Give each action a \`score\` expression describing sensible play, because the Casual bot always
  picks the highest-scoring move. Add \`progress\` (who is ahead mid-game, higher is better),
  \`scoreOrder\`, \`scoreLabel\`, and \`timing\` estimates in seconds for a real table.
- Use the game's own name. The \`id\` is the name in lowercase with hyphens.

## Card effects

- Turn each card's text into \`onPlay\` effects where the format can express it. If it can only be
  approximated, approximate it and add a comment \`# approximated: <how>\`. If it can't be
  expressed at all, leave the card out and list it.
- Never repeat a card's attributes in its entry; they come from the card list.
- After the file, list the cards that are approximated or not modelled, one line each.

## Format reference

${formatReference}

## Example games

### crazy-eights.yaml

\`\`\`yaml
${crazyEights}\`\`\`

### hearts.yaml

\`\`\`yaml
${hearts}\`\`\`

### deck-builder.yaml

\`\`\`yaml
${deckBuilder}\`\`\`
`;

/** Starts the message a designer sends Claude with the problems Card Tester found in a file. */
export const FIX_PROMPT = 'Card Tester reported these problems with the file. Fix every one and give me the complete corrected file:';
