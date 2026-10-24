import type { GameDefinition } from '../engine/types';
import type { Rng } from '../engine/rng';

/*
 * Crazy Eights, standard 52-card deck.
 * - Deal 7 cards each with 2 players, otherwise 5. Flip a starter (an 8 is buried and re-flipped).
 * - On your turn play a card matching the suit or rank of the top card. Eights are wild: play one
 *   any time and name the next suit.
 * - If you can't play, draw one card. If it's playable you may play it, otherwise your turn ends.
 *   (Variant choice: you may not draw while holding a playable card.)
 * - When the draw pile is empty, the discard pile (minus its top card) is reshuffled into it.
 * - First to empty their hand wins. If nobody can play or draw for a full round, the lowest
 *   penalty total wins (8 = 50, face cards = 10, ace = 1, others = face value).
 */

const SUITS = ['♠', '♥', '♦', '♣'] as const;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
type Suit = (typeof SUITS)[number];
type Card = string; // rank + suit, e.g. "10♥"

const rankOf = (card: Card) => card.slice(0, -1);
const suitOf = (card: Card) => card.slice(-1) as Suit;

function penalty(card: Card): number {
  const rank = rankOf(card);
  if (rank === '8') return 50;
  if (rank === 'A') return 1;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return Number(rank);
}

export interface CrazyEightsState {
  numPlayers: number;
  hands: Card[][];
  drawPile: Card[];
  discard: Card[];
  activeSuit: Suit;
  current: number;
  /** The card just drawn this turn, which is the only card the player may now play. */
  drawnCard: Card | null;
  passesInRow: number;
  winner: number | null;
}

export type CrazyEightsAction =
  | { type: 'play'; card: Card; suit?: Suit }
  | { type: 'draw' }
  | { type: 'pass' };

function canPlay(state: CrazyEightsState, card: Card): boolean {
  const top = state.discard[state.discard.length - 1];
  return rankOf(card) === '8' || suitOf(card) === state.activeSuit || rankOf(card) === rankOf(top);
}

function playsFor(card: Card): CrazyEightsAction[] {
  return rankOf(card) === '8' ? SUITS.map((suit) => ({ type: 'play', card, suit })) : [{ type: 'play', card }];
}

function refillDrawPile(state: CrazyEightsState, rng: Rng): void {
  if (state.drawPile.length > 0 || state.discard.length <= 1) return;
  const top = state.discard.pop()!;
  state.drawPile = rng.shuffle(state.discard);
  state.discard = [top];
}

function endTurn(state: CrazyEightsState): void {
  state.drawnCard = null;
  state.current = (state.current + 1) % state.numPlayers;
}

function handPenalty(hand: Card[]): number {
  return hand.reduce((sum, c) => sum + penalty(c), 0);
}

export const crazyEights: GameDefinition<CrazyEightsState, CrazyEightsAction> = {
  id: 'crazy-eights',
  name: 'Crazy Eights',
  description: 'Match the suit or rank of the top card; eights are wild. First to empty their hand wins.',
  minPlayers: 2,
  maxPlayers: 7,
  scoreLabel: 'Penalty points left in hand (lower is better)',
  timing: {
    setupSeconds: 90,
    actionSeconds: (a) => (a.type === 'play' ? 6 : a.type === 'draw' ? 4 : 2),
  },

  setup(numPlayers, rng) {
    const deck = rng.shuffle(SUITS.flatMap((s) => RANKS.map((r) => r + s)));
    const handSize = numPlayers === 2 ? 7 : 5;
    const hands = Array.from({ length: numPlayers }, () => deck.splice(0, handSize));
    while (rankOf(deck[0]) === '8') deck.splice(1 + rng.int(deck.length - 1), 0, deck.shift()!);
    const starter = deck.shift()!;
    return {
      numPlayers,
      hands,
      drawPile: deck,
      discard: [starter],
      activeSuit: suitOf(starter),
      current: 0,
      drawnCard: null,
      passesInRow: 0,
      winner: null,
    };
  },

  currentPlayer: (state) => state.current,

  legalActions(state) {
    if (state.drawnCard !== null) {
      return [...(canPlay(state, state.drawnCard) ? playsFor(state.drawnCard) : []), { type: 'pass' }];
    }
    const plays = state.hands[state.current].filter((c) => canPlay(state, c)).flatMap(playsFor);
    if (plays.length > 0) return plays;
    const canDraw = state.drawPile.length > 0 || state.discard.length > 1;
    return [canDraw ? { type: 'draw' } : { type: 'pass' }];
  },

  applyAction(state, action, rng) {
    const hand = state.hands[state.current];
    switch (action.type) {
      case 'play': {
        hand.splice(hand.indexOf(action.card), 1);
        state.discard.push(action.card);
        state.activeSuit = action.suit ?? suitOf(action.card);
        state.passesInRow = 0;
        if (hand.length === 0) {
          state.winner = state.current;
          return;
        }
        endTurn(state);
        return;
      }
      case 'draw': {
        refillDrawPile(state, rng);
        const card = state.drawPile.pop()!;
        hand.push(card);
        state.passesInRow = 0;
        if (canPlay(state, card)) state.drawnCard = card;
        else endTurn(state);
        return;
      }
      case 'pass':
        state.passesInRow++;
        endTurn(state);
        return;
    }
  },

  isTerminal: (state) => state.winner !== null || state.passesInRow >= state.numPlayers,

  result(state) {
    const scores = state.hands.map(handPenalty);
    if (state.winner !== null) return { winners: [state.winner], scores };
    const best = Math.min(...scores);
    return { winners: scores.flatMap((s, i) => (s === best ? [i] : [])), scores };
  },

  describeAction(state, action) {
    switch (action.type) {
      case 'play':
        return action.suit ? `plays ${action.card} and names ${action.suit}` : `plays ${action.card}`;
      case 'draw':
        return `can't play on ${state.discard[state.discard.length - 1]}, draws a card`;
      case 'pass':
        return 'passes';
    }
  },

  // Play rather than pass, save eights for when you're stuck, and keep the suit you hold most of.
  heuristic(state, action) {
    if (action.type !== 'play') return 0;
    const hand = state.hands[state.current];
    const suit = action.suit ?? suitOf(action.card);
    const sameSuitLeft = hand.filter((c) => c !== action.card && suitOf(c) === suit).length;
    return (rankOf(action.card) === '8' ? 1 : 20) + sameSuitLeft + penalty(action.card) / 100;
  },
};
