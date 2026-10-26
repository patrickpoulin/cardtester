# Card Tester

Play a card game thousands of times and see who wins, how long games take, and which cards matter.
Everything runs in your browser, so the site is hosted for free on GitHub Pages.

## Using it

1. Open the site, choose a game (Crazy Eights, Hearts or a simple deck-builder), the number of
   players and how well each one plays.
2. Click **Run**. Your computer plays all the games, spread across its CPU cores.
3. Read the report: win rate per seat with 95% confidence ranges, first-player advantage, comeback
   wins, lead changes, winning margins, game length, estimated playtime and which cards the winners
   played. **Watch one game** steps through a single game move by move. Download it as a spreadsheet
   (summary or one row per game).

**Compare** tests a change: edit a copy of the game's rules (a card's cost, the hand size) and both
versions are played with the same shuffles. The report says which differences are real and which
could just be luck. Every run is kept under **Saved runs**, where any two can be compared.

**Upload a Game** is where your own games come in. Card Tester plays games written as a
`game.yaml` file ([format reference](docs/game-format.md)). Download the template from that page
and attach it, with your rulebook and card list, to a chat in claude.ai: it tells Claude how to
write the file a step at a time. Then upload the game file and, separately, your card list (CSV or
Excel), whose rows become the game's cards. The app validates the game and plays test games, and
any problems can be copied straight back to Claude. Your games are kept in your browser, and each
can be downloaded as a backup.

## Development

```bash
npm install
npm run dev        # local site at http://localhost:5173/cardtester/
npm test           # engine tests
npm run build      # typecheck + production build into dist/
npm run sim -- --game crazy-eights --players 4 --games 1000 --agents greedy,random
npm run sim -- --file my-game.yaml --players 3
```

`npm run sim -- --help` lists the CLI options; `--json` prints the full summary.

## Layout

| Path | What it is |
|---|---|
| `src/engine/` | Game-agnostic simulator: `types.ts` (the `GameDefinition` interface), seeded `rng.ts`, `agents.ts` (bots), `simulate.ts`, `stats.ts` |
| `src/report/` | Comparing runs with significance tests (`compare.ts`), CSV export, rules-file diff, saved runs in IndexedDB |
| `src/dsl/` | The `game.yaml` format: `schema.ts` (structure), `expr.ts` (rule expressions), `compile.ts` (turns a file into a `GameDefinition`), `smoke.ts` (test-plays a new game) |
| `src/games/` | Built-in games as `game.yaml` files |
| `docs/game-format.md` | Reference for writing game files |
| `src/worker/`, `src/runner.ts` | Splits a run across one Web Worker per CPU core |
| `src/template.ts` | The template designers give Claude to write a `game.yaml` |
| `src/cardList.ts` | Reading an uploaded card list (CSV or Excel) and merging its rows into the game file |
| `src/ui/` | React interface |
| `cli/` | Command-line runner using the same engine |
| `tests/` | Vitest tests; `tests/reference/crazyEights.ts` is a hand-written Crazy Eights used to check the interpreter |

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
