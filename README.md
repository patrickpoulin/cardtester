# Card Tester

Play a card game thousands of times and see who wins, how long games take, and which cards matter.
Everything runs in your browser, so the site is hosted for free on GitHub Pages.

## Using it

1. Open the site, choose a game, the number of players and how well each one plays.
2. Click **Run**. Your computer plays all the games (1,000 games of Crazy Eights take well under a second).
3. Read the report: win rate per seat with 95% confidence ranges, game length, estimated playtime
   and which cards the winners played. **Watch one game** steps through a single game move by move.

Uploading your own rules and cards is coming next (see [PLAN.md](PLAN.md)). That step uses Claude,
with your own API key saved under **Settings**. The key stays in your browser and is sent only to
`api.anthropic.com`. Never commit a key to this repository.

## Development

```bash
npm install
npm run dev        # local site at http://localhost:5173/cardtester/
npm test           # engine tests
npm run build      # typecheck + production build into dist/
npm run sim -- --game crazy-eights --players 4 --games 1000 --agents greedy,random
```

`npm run sim -- --help` lists the CLI options; `--json` prints the full summary.

## Layout

| Path | What it is |
|---|---|
| `src/engine/` | Game-agnostic simulator: `types.ts` (the `GameDefinition` interface), seeded `rng.ts`, `agents.ts` (bots), `simulate.ts`, `stats.ts` |
| `src/games/` | Built-in games. `crazyEights.ts` is the reference implementation |
| `src/worker/`, `src/runner.ts` | Splits a run across one Web Worker per CPU core |
| `src/compiler/` | Claude API client for the upcoming rules compiler |
| `src/ui/` | React interface |
| `cli/` | Command-line runner using the same engine |
| `tests/` | Vitest tests |

### Adding a game by hand

Implement `GameDefinition` (see `src/games/crazyEights.ts`) and add it to `GAMES` in `src/games/index.ts`.
Give each action a `card` field when a card is played so card statistics work automatically, and add a
`heuristic` so the Casual bot plays sensibly.

## Deploying

`.github/workflows/deploy.yml` tests, builds and publishes to GitHub Pages on every push to `main`.
One-time setup: in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.
The site is served at `https://<user>.github.io/cardtester/`; if you rename the repository, update
`base` in `vite.config.ts`.
