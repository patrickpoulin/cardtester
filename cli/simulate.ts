// Command-line runner: same engine as the website, for large runs or scripting.
// Usage: npm run sim -- --game not-snap --players 2 --games 1000 --agents greedy,random --seed 1 [--json]
//        npm run sim -- --file path/to/game.yaml --players 3
import { readFileSync, readdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { GameDefinitionError, loadGame } from '../src/dsl/compile';
import { AGENTS } from '../src/engine/agents';
import { runBatch, type SimConfig } from '../src/engine/simulate';
import { computeStats } from '../src/engine/stats';

const gamesDir = new URL('../src/games/', import.meta.url);
const builtinIds = readdirSync(gamesDir)
  .filter((f) => f.endsWith('.yaml'))
  .map((f) => f.replace(/\.yaml$/, ''));

const { values } = parseArgs({
  options: {
    game: { type: 'string', default: 'not-snap' },
    file: { type: 'string' },
    players: { type: 'string', default: '2' },
    games: { type: 'string', default: '1000' },
    agents: { type: 'string', default: 'greedy' },
    seed: { type: 'string', default: '1' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(`Options:
  --game <id>        ${builtinIds.join(' | ')}
  --file <path>      a game.yaml file to simulate instead of a built-in game
  --players <n>      number of players
  --games <n>        number of games to simulate
  --agents <list>    comma-separated agent per seat; the last one repeats (${AGENTS.map((a) => a.id).join(' | ')})
  --seed <n>         run seed, for reproducible results
  --json             print the full summary as JSON`);
  process.exit(0);
}

const source = values.file ? readFileSync(values.file, 'utf8') : readFileSync(new URL(`${values.game}.yaml`, gamesDir), 'utf8');
let game;
try {
  game = loadGame(source);
} catch (err) {
  if (!(err instanceof GameDefinitionError)) throw err;
  console.error(err.message);
  process.exit(1);
}

const numPlayers = Number(values.players);
const agentList = values.agents.split(',').map((s) => s.trim());
const config: SimConfig = {
  gameId: game.id,
  numPlayers,
  agents: Array.from({ length: numPlayers }, (_, i) => agentList[Math.min(i, agentList.length - 1)]),
  seed: Number(values.seed),
};

const started = performance.now();
const records = runBatch(game, config, 0, Number(values.games));
const elapsed = (performance.now() - started) / 1000;
const s = computeStats(game, records, config);

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
