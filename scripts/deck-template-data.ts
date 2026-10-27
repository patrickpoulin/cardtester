// Prints the starter deck (as the CSV template) and the effect list as JSON, for make-deck-template.py.
import { readFileSync } from 'node:fs';
import { deckCsv, EFFECTS } from '../src/deck';

const rules = readFileSync(new URL('../src/games/not-snap.yaml', import.meta.url), 'utf8');
console.log(JSON.stringify({ csv: deckCsv(rules), effects: EFFECTS }));
