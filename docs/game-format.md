# The game.yaml format

A game file describes a card game's components and rules so Card Tester can play it. The built-in
games in [`src/games/`](../src/games) are complete examples:

- [`crazy-eights.yaml`](../src/games/crazy-eights.yaml): shedding game, choices (naming a suit), drawing with reshuffles
- [`hearts.yaml`](../src/games/hearts.yaml): trick-taking, rounds, scoring across rounds
- [`deck-builder.yaml`](../src/games/deck-builder.yaml): custom cards with effects, turn phases, per-player decks

A file is checked when it is loaded, and every problem is reported with its location,
e.g. `actions[0].effects[2].move.to: "hands" is not a player zone`.

## How a game runs

1. Cards are created and placed in their starting zones; `setup` runs once.
2. If the game has `round`, `round.setup` runs.
3. `turn.start` runs for the current player (player 0 unless setup changed `current`).
4. The current player picks one of the legal **actions**. Its effects run.
5. If the action ends the turn: `turn.end` runs, play passes to the next player
   (or to whoever `nextPlayer` named), and `turn` goes up by 1.
6. `endWhen` is checked; if true the game is over.
7. If `round.endWhen` is true: `round.onEnd` runs, `round` goes up by 1, `endWhen` is checked
   again, then `round.setup` runs for the next round.
8. Back to step 3 (or 4 if the turn didn't end).

When the game ends, `winners` decides who won and `score` gives each player's final score.

## Top-level fields

| Field | Required | Description |
|---|---|---|
| `id` | yes | Lowercase letters, digits and `-`, e.g. `my-game` |
| `name` | yes | Display name |
| `description` | | One or two sentences shown in the app |
| `players` | yes | `{ min: 2, max: 4 }` |
| `scoreLabel` | | What `score` means, e.g. `Victory points` or `Penalty points (lower is better)` |
| `scoreOrder` | | `higher` (default) or `lower`: whether a high or a low final score is good; used for winning margins |
| `timing` | | Real-world seconds for the playtime estimate: `{ setup: 90, default: 4, actions: { play: 6 } }` |
| `cards` | yes | The cards in the game (see below) |
| `cardList` | | Where the rows of an uploaded card list go (see [Card lists](#card-lists)) |
| `zones` | yes | Where cards can be (see below) |
| `vars` | | Numbers, text or true/false values the rules keep track of |
| `define` | | Named expressions and helper functions |
| `setup` | | Effects run once at the start |
| `round` | | `{ setup, endWhen, onEnd }` for games played over several hands |
| `turn` | | `{ start, end }` effects run at the start and end of every turn |
| `actions` | yes | What a player can do on their turn |
| `endWhen` | yes | Expression; the game ends when it is true |
| `winners` | yes | Expression giving the winning player(s) |
| `score` | | Expression giving each player's final score; `p` is the player |
| `progress` | | Expression saying how far ahead player `p` is mid-game (higher is better); enables comeback and lead-change statistics |

## Cards

```yaml
cards:
  - deck: standard52        # the 52-card deck, placed in zone "deck" unless `zone` says otherwise
  - name: Silver
    count: 40               # copies placed in `zone` (a shared zone, default "deck"); may be an expression
    zone: supply
    perPlayer: { count: 7, zone: deck }   # copies given to every player
    attrs: { kind: treasure, cost: 3, coins: 2 }
    onPlay:                 # effects run by `runCard: card`
      - add: { var: me.coins, value: 2 }
```

Every card has `id` (unique number), `name`, and its `attrs`. Standard-deck cards have `rank`
(`"A"`, `"2"` … `"10"`, `"J"`, `"Q"`, `"K"`), `suit` (`"♠"`, `"♥"`, `"♦"`, `"♣"`), `color`
(`"red"`/`"black"`), `value` (A = 1 … K = 13) and `rankHigh` (like `value` but A = 14).
A card that has been moved during a player's turn also has `by`: the number of that player.

### Card lists

A game with many cards can keep them in a spreadsheet (CSV, TSV or Excel `.xlsx`) uploaded beside
the game file on the Upload a Game page. Each row becomes a cards entry:

- The card's name comes from the `Name`, `Card Name`, `Card`, `Unique ID` or `ID` column (the
  first column if there is none of these).
- `Count` (or `Copies`, `Quantity`) is how many copies go in `Zone`; `Per Player` and
  `Player Zone` work like `perPlayer`.
- Every other column becomes an attribute, named in camelCase: `Casting Cost` is `card.castingCost`,
  `Card Type` is `card.cardType`. Number cells are numbers. Empty cells are left out.

The game file says where listed cards go when a row has no placement columns:

```yaml
cardList: { perPlayer: { count: 1, zone: deck } }   # or { count: 1, zone: deck } for a shared pile
```

A cards entry with the same name as a row is updated from the row (placement and attributes) and
keeps its `onPlay`, so the game file only needs entries for cards with effects:

```yaml
cards:
  - name: Treasure Map
    onPlay:
      - draw: { from: me.deck, to: me.hand, count: "card.draws" }
```

## Zones

```yaml
zones:
  shared:                   # one of each for the table
    deck: { visibility: hidden }
    discard: { visibility: top }
  player:                   # one of each per player
    hand: { visibility: owner }
```

A zone is an ordered pile. The **last** card is the top: `top(deck)` is the next card drawn.
Visibility (`hidden`, `top`, `owner`, `public`) is recorded for future smarter bots and doesn't
change how the game plays today.

## Variables

```yaml
vars:
  shared: { ledSuit: null, heartsBroken: false }
  player: { score: 0, coins: 0 }
```

Values here are taken literally (they are not expressions).

## Names available in expressions

| Name | Meaning |
|---|---|
| shared zone or variable names | e.g. `deck`, `discard`, `ledSuit` |
| `me` | the current player: `me.hand`, `me.score`, `me.index` |
| `players` | list of all players; each has `index`, its zones and its variables |
| `current` | number of the current player (0-based) |
| `numPlayers`, `turn`, `round` | numbers (turn and round start at 1) |
| `define` names | see below |
| `card` | inside an action with `card:`, the card being considered |
| choice names | inside an action with `choose:`, the chosen option (or `null` if the choice didn't apply) |

## Expressions

Expressions are written as YAML strings. Quote text inside them: `card.suit == '♥'`.

- Values: `3`, `2.5`, `'text'`, `true`, `false`, `null`, lists `[1, 2, 3]`
- Fields: `card.suit`, `me.hand`, `players[0].score`, `hand[-1]` (negative counts from the end)
- Arithmetic: `+ - * / %`; `+` also joins text and lists
- Comparison: `== != < <= > >=`, `x in list`, `x not in list`
- Logic: `and`, `or`, `not` (or `&& || !`); `a ?? b` gives `b` when `a` is `null`
- Choice: `test ? a : b` or `if(test, a, b)`
- Functions: `c => c.value` or `(a, b) => a + b`

A missing field reads as `null`. Reading a field of `null` (for example `top(deck).rank` when the
deck is empty) is an error that names the rule it happened in.

### Built-in functions

| Function | Result |
|---|---|
| `len(list)` | number of items |
| `top(list)`, `bottom(list)` | last / first item, or `null` |
| `filter(list, f)`, `map(list, f)` | items where `f` is true / `f` applied to each item |
| `any(list, f)`, `all(list, f)` | whether some / every item matches (`any(list)` = not empty) |
| `count(list, f)` | number of matching items (`count(list)` = `len`) |
| `sum(list, f)` | total of `f` over the items (`sum(list)` adds the items) |
| `min(...)`, `max(...)` | smallest / largest of numbers or of a list; `null` when empty |
| `maxBy(list, f)`, `minBy(list, f)` | the first item with the largest / smallest `f` |
| `highest(list, f)`, `lowest(list, f)` | all items tied for the largest / smallest `f` |
| `contains(list, x)`, `indexOf(list, x)` | membership / position (-1 if absent) |
| `concat(a, b, ...)`, `unique(list)`, `reverse(list)`, `sortBy(list, f)` | list helpers |
| `range(n)`, `range(a, b)` | `[0 … n-1]`, `[a … b-1]` |
| `abs`, `floor`, `ceil`, `round` | number helpers |

### define

```yaml
define:
  points: "c => c.suit == '♥' ? 1 : (c.name == 'Q♠' ? 13 : 0)"   # helper function
  canFollow: "any(me.hand, c => c.suit == ledSuit)"                # value computed from the state
```

Defines are evaluated when used and see the current state. Their values are cached until the next
effect runs, so moving a repeated sub-expression into a define also makes simulations faster.

## Actions

```yaml
actions:
  - id: play                # unique; also the key for timing.actions
    label: plays            # used in the move-by-move log: "Player 2: plays 8♥ (suit: ♠)"
    when: "phase == 'action'"           # optional: is this action available at all?
    card:                               # optional: one choice per matching card
      from: me.hand
      where: "card.suit == ledSuit"
      distinct: true                    # default; cards with the same name count as one choice
    choose:                             # optional: extra decisions, one choice per option
      suit: { options: "['♠', '♥', '♦', '♣']", when: "card.rank == '8'" }
    require: "..."                      # optional: final check using card and choices
    effects: [ ... ]
    endsTurn: true                      # default; false lets the player act again
    score: "card.rankHigh"              # optional: how much the Casual bot likes this move
```

Every reachable situation must offer at least one action; add a `pass` action where needed.
The **Beginner** bot picks uniformly at random. The **Casual** bot picks the highest `score`
(ties at random), so a good `score` makes the statistics reflect sensible play.

## Effects

| Effect | What it does |
|---|---|
| `move: { card: card, to: discard }` | move one card from wherever it is |
| `move: { cards: "filter(me.hand, c => ...)", to: me.discard }` | move several specific cards |
| `move: { from: deck, to: me.hand, count: 2 }` | move the top 2 cards (`all: true` moves every card) |
| … `position: bottom` | put the cards under the destination pile instead of on top |
| `draw: { from: me.deck, to: me.hand, count: 5, refill: { from: me.discard } }` | draw; when `from` runs out, shuffle the refill pile into it (`keepTop: 1` leaves its top card) |
| `deal: { from: deck, to: hand, count: 5 }` | deal round-robin into each player's `hand` zone |
| `shuffle: deck` | shuffle a zone |
| `set: { var: me.coins, value: 0 }` | set a variable (`ledSuit`, `me.score`, `p.score`, or `current`) |
| `add: { var: me.coins, value: "card.coins" }` | add to a number variable (use a negative value to subtract) |
| `if: "test"`, `then: [...]`, `else: [...]` | conditional effects |
| `forEach: { in: players, as: p, do: [...] }` | repeat for each item, binding it to a name |
| `while: "test"`, `do: [...]` | repeat while the test is true (stops with an error after 10,000 loops) |
| `runCard: card` | run that card's `onPlay` effects, with `card` bound to it |
| `nextPlayer: trickWinner` | when this turn ends, play passes to this player (a number or player) |
| `endTurn: true` | end the turn after this action, even if the action has `endsTurn: false` |
| `endGame: true` | end the game immediately |

Text values must be quoted inside the expression: `set: { var: phase, value: "'buy'" }`.

## Winners and scores

```yaml
winners: "lowest(players, p => p.score)"   # a player, a list of players, or player numbers
score: "p.score"                            # evaluated for each player as p
```

Several winners means a shared win; each gets an equal share in the win-rate statistics.

## Progress (who's ahead mid-game)

```yaml
progress: "-len(p.hand)"                                   # Crazy Eights: fewer cards is better
progress: "-(p.score + sum(p.taken, c => points(c)))"      # Hearts: fewer points is better
progress: "vp(p)"                                           # deck-builder: more victory points
```

`progress` is checked at the start of every turn. Higher always means further ahead, so negate
values where less is better. From it the report measures:

- **Comeback wins:** games won by a player who wasn't alone in the lead halfway through.
- **Lead changes:** how many times the sole leader changed during a game (ties don't count).

The **winning margin** (gap between the winner's final score and the best other score) uses
`score` and `scoreOrder` and doesn't need `progress`.
