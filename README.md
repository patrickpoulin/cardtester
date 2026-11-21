# Card Tester

Play a card game thousands of times and see who wins, how long games take, and which cards matter.
Everything runs in your browser, so the site is hosted for free on GitHub Pages.

## Using it

The game, its settings and its decks all come from a Google Sheet, so cards and numbers are changed in the sheet
and tested here.

1. Open the site. Under **Your Google Sheet**, pick an example (Not Snap, a Marvel Snap-style lane
   battler, or Rascally Raccoons, a race to hold Percy the Dog when the last raccoon turns up) and
   click **Make a copy**. Share your copy as **Anyone with the link can view** and paste its link
   into the box (or open the site with `?sheet=<link>`). **Try it** loads an example as it is.
2. Click **Analyze**. The sheet says which game it is, so its rules, settings and decks load
   together, and Claude turns each card's text into rules (see below). The table shows how each
   card text will play. Then click **Build test**.
3. Choose a deck from the sheet and how well each player plays, then click **Run**. Your computer
   plays all the games, spread across its CPU cores.
4. Read the report: win rate per seat with 95% confidence ranges, first-player advantage, comeback
   wins, lead changes, winning margins, game length, estimated playtime and which cards the winners
   played. **Watch one game** steps through a single game move by move. Download it as a spreadsheet
   (summary or one row per game).

Change the sheet, click **Analyze** again, and run again. Every run is kept under **Saved runs**,
and **Compare** puts any two of them side by side and says which differences are real and which
could just be luck.

Example sheets (read-only):
[Not Snap](https://docs.google.com/spreadsheets/d/18MKJkmbiJXNpaWK75qcFVc-S_7cUKb3oKUIr3plwUuQ/edit?usp=sharing),
[Rascally Raccoons](https://docs.google.com/spreadsheets/d/1ZEg5t5cTxueYxp50WYw0vDEU6uOupPD1n-r6cPwJ2NE/edit?usp=sharing).

### The sheet

The site reads the sheet every time it opens (no API key needed). If the sheet can't be reached, the
last copy that loaded in this browser is used. It needs:

- a **Decks** tab with `Game` (Not Snap or Rascally Raccoons), `Deck name` and `Tab` columns, one row
  per deck. Without `Game`, the game is worked out from the deck tab's columns;
- one tab per deck, in the game's card columns (`src/deckFormats.ts`):
  - **Not Snap**: Name, Per Player, Cost, Power and Ability, the card's text in plain English
    (On Reveal, Ongoing, When Destroyed and end-of-turn abilities can all be played).
  - **Rascally Raccoons**: Card Name, Text, Copies and Effect, the original card it plays like.
    Cards named like an original card don't need an Effect.
- for Not Snap, optionally a **Card Pool** tab in the deck columns plus `Copies` (2 by default):
  the cards abilities can create or add, such as "add a random card to your hand" or "shuffle 4
  Ancient Arcana into your deck";
- optionally a **Settings** tab with `Setting` and `Value` columns. Not Snap's settings are
  `openingHand`, `turns`, `handLimit`, `drawPerTurn`, `cardsPerLocation`, `forgeBonus` and
  `bogPenalty`; Rascally Raccoons has `endYourTurnSkipsDraw`.

Other tabs are ignored. The game's rules come from its rules file (`src/games/*.yaml`); the loader
is `src/sheet.ts`.

### Card text and the Claude API key

Not Snap card text is turned into rules by Claude (`src/ai/`). Paste a Claude API key (from the
[Claude Console](https://console.anthropic.com/settings/keys)) into the site; it stays in your
browser and is sent only to the Claude API. Each text is translated once, test-played in a few dozen
quick games, and remembered in the browser, so it plays the same way in every run until its wording
changes, and analyzing again costs nothing unless card text changed. Abilities can trigger On
Reveal, Ongoing, When Destroyed, at the end of your turn, at Game Start, after a card is played, and
when any card is destroyed (even from the hand or deck); they can see the last card each player
played, copy another card's On Reveal, remove a card's text, banish cards, and take cards from the
Card Pool. A translation that fails test
play is sent back once to be fixed; if it still fails, the card plays without its ability and the
table says why. The wording the example sheets use comes already translated, so the examples play
without a key. Rascally Raccoons cards still name the original card they play like.

## Development

```bash
npm install
npm run dev        # local site at http://localhost:5173/cardtester/
npm test           # engine tests
npm run build      # typecheck + production build into dist/
npm run sim -- --game not-snap --players 2 --games 1000 --agents greedy,random
npm run sim -- --file my-game.yaml --players 3
```

`npm run sim -- --help` lists the CLI options; `--json` prints the full summary.

## Layout

| Path | What it is |
|---|---|
| `src/engine/` | Game-agnostic simulator: `types.ts` (the `GameDefinition` interface), seeded `rng.ts`, `agents.ts` (bots), `simulate.ts`, `stats.ts` |
| `src/report/` | Comparing runs with significance tests (`compare.ts`), CSV export, rules-file diff, saved runs in IndexedDB |
| `src/dsl/` | The `game.yaml` format: `schema.ts` (structure), `expr.ts` (rule expressions), `compile.ts` (turns a file into a `GameDefinition`), `smoke.ts` (test-plays a new game) |
| `src/games/` | The rules and original decks of Not Snap (`not-snap.yaml`) and Rascally Raccoons (`rascally-raccoons.yaml`) |
| `docs/game-format.md` | Reference for writing game files |
| `src/worker/`, `src/runner.ts` | Splits a run across one Web Worker per CPU core |
| `src/deck.ts`, `src/raccoonDeck.ts` | Each game's decks: the effect list, checking a deck, and building its game |
| `src/deckFormats.ts` | The games on the Simulate page, their deck columns, settings and example sheets |
| `src/sheet.ts`, `src/cardList.ts` | Reading a game's Google Sheet, and turning its rows of cards into a game file |
| `src/ui/` | React interface |
| `cli/` | Command-line runner using the same engine |
| `tests/` | Vitest tests; `tests/fixtures/games/` keeps Crazy Eights, Hearts and a deck-builder for engine tests, and `tests/reference/crazyEights.ts` is a hand-written Crazy Eights used to check the interpreter |

### Adding a built-in game

Write a `game.yaml` (see [docs/game-format.md](docs/game-format.md)), save it in `src/games/`, and add
it to the list in `src/games/index.ts`. The tests automatically play every built-in game at every
player count. Give actions a `score` so the Casual bot plays sensibly.

Games can also be written directly in TypeScript by implementing `GameDefinition`; see
`tests/reference/crazyEights.ts`.

## Deploying

`.github/workflows/deploy.yml` tests, builds and publishes to GitHub Pages on every push to `main`.
One-time setup: in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.
The site is served at `https://<user>.github.io/cardtester/`; if you rename the repository, update
`base` in `vite.config.ts`.
