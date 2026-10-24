import { playGame, type SimConfig } from '../engine/simulate';
import type { AnyGame } from '../engine/types';

const MAX_ACTIONS = 10_000;

/**
 * Plays a few quick games with random players at every allowed player count and reports rules
 * that fail during play or games that never finish. Catches what static checks can't, such as a
 * misspelled field (`me.hnd`) or a situation where no action is available.
 */
export function smokeTest(game: AnyGame, gamesPerCount = 10): string[] {
  const problems = new Map<string, string>();
  let unfinished = 0;
  let played = 0;
  for (let n = game.minPlayers; n <= game.maxPlayers; n++) {
    const config: SimConfig = { gameId: game.id, numPlayers: n, agents: new Array(n).fill('random'), seed: 1, maxActions: MAX_ACTIONS };
    for (let i = 0; i < gamesPerCount; i++) {
      played++;
      try {
        if (playGame(game, config, i).record.hitActionLimit) unfinished++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!problems.has(message)) problems.set(message, `${message} (first seen with ${n} players, test game ${i + 1})`);
      }
    }
  }
  const out = [...problems.values()];
  if (unfinished > 0) {
    out.push(`${unfinished} of ${played} test games didn't finish within ${MAX_ACTIONS.toLocaleString('en-US')} moves; check endWhen and round.endWhen`);
  }
  return out;
}
