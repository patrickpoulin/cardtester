import type { Action, AnyGame } from './types';
import type { Rng } from './rng';

/** A bot that picks one of the legal moves. */
export interface Agent {
  id: string;
  label: string;
  description: string;
  choose<S>(game: AnyGame, state: S, legal: Action[], rng: Rng): Action;
}

const random: Agent = {
  id: 'random',
  label: 'Beginner',
  description: 'Picks any legal move at random.',
  choose: (_game, _state, legal, rng) => rng.pick(legal),
};

const greedy: Agent = {
  id: 'greedy',
  label: 'Casual',
  description: "Picks the move the game's heuristic rates best right now; ties broken at random.",
  choose(game, state, legal, rng) {
    if (!game.heuristic) return rng.pick(legal);
    let best: Action[] = [];
    let bestScore = -Infinity;
    for (const action of legal) {
      const score = game.heuristic(state, action);
      if (score > bestScore) {
        bestScore = score;
        best = [action];
      } else if (score === bestScore) {
        best.push(action);
      }
    }
    return rng.pick(best);
  },
};

// 'expert' (ISMCTS) is planned for Phase 4.
export const AGENTS: Agent[] = [random, greedy];

export function getAgent(id: string): Agent {
  const agent = AGENTS.find((a) => a.id === id);
  if (!agent) throw new Error(`Unknown agent "${id}". Available: ${AGENTS.map((a) => a.id).join(', ')}`);
  return agent;
}
