// Prints each game's original deck (as the CSV template) and its effect list as JSON, for make-deck-template.py.
import { readFileSync } from 'node:fs';
import { deckCsv, EFFECTS } from '../src/deck';
import { raccoonDeckCsv, raccoonEffects } from '../src/raccoonDeck';

const read = (file: string) => readFileSync(new URL(`../src/games/${file}`, import.meta.url), 'utf8');
const notSnap = read('not-snap.yaml');
const raccoons = read('rascally-raccoons.yaml');
console.log(
  JSON.stringify({
    notSnap: { csv: deckCsv(notSnap), effects: EFFECTS },
    raccoons: { csv: raccoonDeckCsv(raccoons, raccoons), effects: raccoonEffects(raccoons) },
  }),
);
