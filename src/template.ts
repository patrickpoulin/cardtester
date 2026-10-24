import formatReference from '../docs/game-format.md?raw';
import crazyEights from './games/crazy-eights.yaml?raw';
import deckBuilder from './games/deck-builder.yaml?raw';
import hearts from './games/hearts.yaml?raw';

/*
 * What a designer gives Claude (in claude.ai, outside this site) to have it write a game.yaml: a
 * template file to attach alongside their rules and card list, and the prompts to send with it.
 */

export const TEMPLATE_FILE_NAME = 'card-tester-template.md';

export const TEMPLATE = `# Card Tester game file template

This file is for Claude. It explains how to turn a card game's rulebook and card list into a
\`game.yaml\` file for Card Tester, a tool that plays a game thousands of times to measure balance,
length and fairness. The person you're working with is usually the game's designer, and the
statistics they get are only as good as the file you write.

## How to work

Build the file in steps, so that no single reply has too much to do:

1. **Core rules first.** Model the game from the rulebook only. If there is a card list, use a few
   placeholder cards that cover its range (cheap, mid and expensive, for example) so the game can
   be played. If the card list has fewer than about 40 cards, include them all now instead.
2. **Cards in batches.** When asked, add the real cards about 40 at a time, adding only the rules
   those cards need.
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
  fixed test deck and say how you chose it.
- Every situation that can arise must leave the current player at least one legal action, and the
  game must always end. Add a pass action and a turn limit where needed.
- Give each action a \`score\` expression describing sensible play, because the Casual bot always
  picks the highest-scoring move. Add \`progress\` (who is ahead mid-game, higher is better),
  \`scoreOrder\`, \`scoreLabel\`, and \`timing\` estimates in seconds for a real table.
- Use the game's own name. The \`id\` is the name in lowercase with hyphens.

## Card lists

- Create one \`cards\` entry per distinct card with its count and its columns as \`attrs\`
  (cost, type, attack and so on, with short lowercase keys).
- Turn each card's text into \`onPlay\` effects where the format can express it. If it can only be
  approximated, approximate it and add a comment \`# approximated: <how>\`. If it can't be
  expressed at all, keep the card with its attrs, leave out \`onPlay\`, and add
  \`# not modelled: <reason>\`.
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

export interface ClaudePrompt {
  title: string;
  when: string;
  text: string;
}

export const PROMPTS: ClaudePrompt[] = [
  {
    title: 'Start: the core rules',
    when: 'Send first, with your rulebook, your card list (if you have one) and the template attached.',
    text: `Attached are my card game's rulebook, my card list, and ${TEMPLATE_FILE_NAME}. Follow the template to write a game.yaml for Card Tester. Do step 1 only: model the core rules with placeholder cards, list your simplifications and any questions, then give me the complete file.`,
  },
  {
    title: 'Add cards in batches',
    when: 'Once the core file loads in Card Tester. Repeat with the next rows until every card is in.',
    text: 'That file works. Now add the cards in rows 1 to 40 of my card list, following step 2 of the template. Give me the complete updated file, then list any cards that are approximated or not modelled.',
  },
  {
    title: 'Fix problems',
    when: 'When Card Tester reports problems with a file. Paste them after the prompt.',
    text: 'Card Tester reported these problems with the file. Fix every one and give me the complete corrected file:',
  },
  {
    title: 'Continue a cut-off file',
    when: "If Claude's reply stops before the file is finished.",
    text: 'Continue the file exactly where you stopped, in a new yaml code block.',
  },
];
