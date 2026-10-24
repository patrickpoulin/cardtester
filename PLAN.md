# Plan

**Goal:** upload a card game's rules and card list, simulate it thousands of times, and get detailed
statistics: who wins, how long games take, first-player advantage and card balance.

**Architecture:** a static site on GitHub Pages. Simulations run in the browser on Web Workers.
Claude, called directly from the browser with the user's own API key, is used once per game to turn
the rulebook into a playable definition, never per move.

**Flow:** upload → compile (Claude) → validate (user and automated checks) → simulate → report.

## Roadmap

| Phase | Deliverable | Status |
|---|---|---|
| 0. Engine MVP | `GameDefinition` interface, seeded simulator, Beginner/Casual bots, stats, one hand-written game (Crazy Eights), Web Worker runner, CLI, Pages deploy | ✅ Done |
| 1. Game definition language | `game.yaml` format validated with zod: cards with attributes and on-play effects, shared and per-player zones and variables, setup, rounds, turn hooks, actions with conditions, card picks and choices, effects, end conditions. A sandboxed expression language (no `eval`) for rules. Interpreter producing a `GameDefinition`. Crazy Eights, Hearts and a simple deck-builder ported; the YAML Crazy Eights matches the hand-written one statistically. Paste-a-game in the UI with validation and test play. Reference: [docs/game-format.md](docs/game-format.md) | ✅ Done |
| 2. Richer reports | First-player advantage, comeback wins, lead changes and winning margins (from a new `progress` rule). Compare page: edit a copy of a game and play both versions with the same shuffles; each difference is tested for significance (card rows corrected for picking the biggest movers). Saved runs in IndexedDB with view, delete and compare-any-two. CSV downloads of the summary, every game and comparisons | ✅ Done |
| 3. Rules compiler | Upload rules (PDF/Word/text) and a card spreadsheet (mapped to `cards` entries). Claude produces `game.yaml`, using docs/game-format.md as its reference, plus a list of ambiguities for the user to answer. Validation and test-play errors go back to Claude to fix. Sample-game viewer for checking | Next |
| 4. Expert bot | Information-set Monte Carlo tree search (ISMCTS) so results reflect skilled play; mixed-skill tables | |
| 5. Polish | Import/export game files, shareable result links, playtime calibration from real playtests | |

## Key decisions

- **Bring your own key.** A static site can't hide a secret, so each user supplies their own Claude
  API key, stored only in their browser. A small proxy (e.g. a Cloudflare Worker) would be needed
  to offer the site without user keys.
- **Determinism.** Every game's seed derives from the run seed and game number, so results are
  reproducible however the run is split across workers.
- **Playtime is an estimate.** Simulated actions are converted with per-action seconds defined by
  each game, which should be calibrated against real playtests.
- **Bot quality affects the results.** Random players make most games look balanced; draw balance
  conclusions from the Casual and (later) Expert bots, and always report which bots were used.

## Performance

Interpreted rules are slower than hand-written code: on one core, 1,000 games take about 0.6 s for
Crazy Eights and 7–8 s for Hearts (played to 100 points) or the deck-builder. The browser
splits runs across all cores. If larger runs are needed, the next step is resolving names at compile
time instead of looking them up while playing.

## Risks

1. Complex card text (e.g. games like Magic) will strain any definition language. Mitigation: a
   small custom-code escape hatch for unusual effects.
2. A rule the compiler misreads produces confident but wrong statistics. Mitigation: the ambiguity
   questions and the sample-game viewer.
