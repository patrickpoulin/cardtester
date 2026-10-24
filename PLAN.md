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
| 1. Game definition language | `game.yaml` schema (zones, cards from CSV, setup, phases, actions with preconditions/effects, triggers, end conditions) validated with zod, plus an interpreter that produces a `GameDefinition`. Port Crazy Eights, Hearts and a simple deck-builder to prove it's expressive enough | Next |
| 2. Richer reports | Comeback rate, lead changes, score margins, A/B comparison of two rule or card variants, CSV export, saved runs in IndexedDB | |
| 3. Rules compiler | Upload rules (PDF/Word/text) and a card spreadsheet. Claude produces `game.yaml` plus a list of ambiguities for the user to answer. Smoke tests flag games that never end, deadlocks and lopsided win rates. Sample-game viewer for checking | |
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

## Risks

1. Complex card text (e.g. games like Magic) will strain any definition language. Mitigation: a
   small custom-code escape hatch for unusual effects.
2. A rule the compiler misreads produces confident but wrong statistics. Mitigation: the ambiguity
   questions and the sample-game viewer.
