// Command-line runner: same engine as the website, for large runs or scripting.
// Usage: npm run sim -- --game crazy-eights --players 4 --games 1000 --agents greedy,random --seed 1 [--json]
import { parseArgs } from 'node:util';
import { AGENTS } from '../src/engine/agents';
import { runBatch, type SimConfig } from '../src/engine/simulate';
import { computeStats } from '../src/engine/stats';
import { GAMES } from '../src/games';

const { values } = parseArgs({
  options: {
    game: { type: 'string', default: GAMES[0].id },
    players: { type: 'string', default: '4' },
    games: { type: 'string', default: '1000' },
    agents: { type: 'string', default: 'greedy' },
    seed: { type: 'string', default: '1' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(`Options:
  --game <id>        ${GAMES.map((g) => g.id).join(' | ')}
  --players <n>      number of players
  --games <n>        number of games to simulate
  --agents <list>    comma-separated agent per seat; the last one repeats (${AGENTS.map((a) => a.id).join(' | ')})
  --seed <n>         run seed, for reproducible results
  --json             print the full summary as JSON`);
  process.exit(0);
}

const numPlayers = Number(values.players);
const agentList = values.agents.split(',').map((s) => s.trim());
const config: SimConfig = {
  gameId: values.game,
  numPlayers,
  agents: Array.from({ length: numPlayers }, (_, i) => agentList[Math.min(i, agentList.length - 1)]),
  seed: Number(values.seed),
};

const started = performance.now();
const records = runBatch(config, 0, Number(values.games));
const elapsed = (performance.now() - started) / 1000;
const s = computeStats(records, config);

if (values.json) {
  console.log(JSON.stringify(s, null, 2));
  process.exit(0);
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`\n${s.gameName}: ${s.games} games, ${s.numPlayers} players (${elapsed.toFixed(2)}s)\n`);
console.table(
  s.seats.map((seat) => ({
    Seat: seat.seat + 1,
    Player: seat.agent,
    'Win rate': pct(seat.winRate),
    '95% range': `${pct(seat.ci95[0])}-${pct(seat.ci95[1])}`,
    'Avg score': seat.avgScore.toFixed(1),
  })),
);
console.log(`Turns per game:  mean ${s.turns.mean.toFixed(1)}, median ${s.turns.median}, 10-90% ${s.turns.p10}-${s.turns.p90}`);
console.log(`Est. playtime:   mean ${s.minutes.mean.toFixed(1)} min, median ${s.minutes.median.toFixed(1)} min`);
console.log(`No winner:       ${pct(s.noWinnerRate)}`);
console.log(`\nCards most often played by the winner (baseline ${pct(1 / s.numPlayers)}):`);
console.table(
  s.cards.slice(0, 5).map((c) => ({ Card: c.card, 'Plays/game': c.playsPerGame.toFixed(2), 'By winner': pct(c.playedByWinner) })),
);
