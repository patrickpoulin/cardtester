import { isMap, isSeq, parse, parseDocument, type Document, type YAMLMap, type YAMLSeq } from 'yaml';

/*
 * Card abilities written in plain English on the sheet, turned into Not Snap rules by Claude (see
 * translate.ts). Each ability becomes up to five pieces of rules code, all written against the same
 * names so they can be checked and stored on their own:
 *
 *   self   the card with the ability       owner  the player who has it
 *   lane   the location self is at (1-3)   l      (Ongoing only) the location being scored
 *
 * - onReveal, whenDestroyed and endOfTurn are YAML lists of effects (game-format.md, Effects).
 * - ongoingMine / ongoingTheirs are expressions: how much self adds to its owner's / the
 *   opponent's power at location l while self is in play.
 *
 * The pieces are spliced into the Not Snap rules: On Reveal runs after a card is played, End of turn
 * runs for each of the owner's cards in play when the owner ends a turn, Ongoing adds to lanePower,
 * and When Destroyed runs when a card reaches its owner's destroyed pile (however it got there).
 */

export interface CardAbility {
  /** The ability text as it reads in the sheet. */
  text: string;
  /** One sentence on how the card will play, for people to check. */
  summary: string;
  onReveal: string;
  ongoingMine: string;
  ongoingTheirs: string;
  whenDestroyed: string;
  endOfTurn: string;
  /** Why some or all of the text can't be played; empty when it all can. */
  unsupported: string;
}

export const CODE_FIELDS = ['onReveal', 'ongoingMine', 'ongoingTheirs', 'whenDestroyed', 'endOfTurn'] as const;

/** The same ability text, however it's spaced or capitalized. */
export const abilityKey = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();

/** Whether an ability does anything in the rules. */
export const hasCode = (a: CardAbility) => CODE_FIELDS.some((f) => a[f].trim() !== '');

function steps(doc: Document, src: string, what: string): YAMLSeq {
  let value: unknown;
  try {
    value = parse(src);
  } catch (err) {
    throw new Error(`${what} isn't valid YAML: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
  }
  if (value === null || value === undefined) return doc.createNode([]) as YAMLSeq;
  if (!Array.isArray(value)) throw new Error(`${what} must be a list of effects`);
  return doc.createNode(value) as YAMLSeq;
}

const node = (doc: Document, value: unknown) => doc.createNode(value);

/** Effects that run `code` for each ability whose card is `self`, with self, owner and lane bound by the caller. */
function dispatch(doc: Document, abilities: Map<string, CardAbility>, field: 'onReveal' | 'whenDestroyed' | 'endOfTurn'): unknown[] {
  const out: unknown[] = [];
  for (const [id, a] of abilities) {
    if (!a[field].trim()) continue;
    out.push({ if: `self.ai == '${id}'`, then: steps(doc, a[field], `${a.text}: ${field}`).toJSON() });
  }
  return out;
}

/** "self.ai == 'a1' ? (e1) : (self.ai == 'a2' ? (e2) : 0)" for one Ongoing side. */
function ongoing(abilities: Map<string, CardAbility>, field: 'ongoingMine' | 'ongoingTheirs'): string | null {
  const parts = [...abilities].filter(([, a]) => a[field].trim()).map(([id, a]) => [id, a[field].trim()] as const);
  if (!parts.length) return null;
  return parts.reduceRight((rest, [id, expr]) => `(self.ai == '${id}' ? (${expr}) : ${rest})`, '0');
}

const inPlay = (p: string) => `concat(${p}.lane1, ${p}.lane2, ${p}.lane3)`;

// When Destroyed runs for each card in a destroyed pile that hasn't been handled yet, so it works
// however the card was destroyed. A When Destroyed ability can destroy more cards, hence the loop.
const UNHANDLED = 'any(players, p => any(p.destroyed, c => not c.handled))';
function sweep(doc: Document, abilities: Map<string, CardAbility>) {
  return {
    while: UNHANDLED,
    do: [
      {
        forEach: {
          in: 'players',
          as: 'owner',
          do: [
            {
              forEach: {
                in: 'filter(owner.destroyed, c => not c.handled)',
                as: 'self',
                do: [
                  { set: { var: 'self.handled', value: true } },
                  { forEach: { in: '[self.lane]', as: 'lane', do: dispatch(doc, abilities, 'whenDestroyed') } },
                ],
              },
            },
          ],
        },
      },
    ],
  };
}

function action(doc: Document, id: string): YAMLMap {
  const actions = doc.get('actions');
  const found = isSeq(actions) ? actions.items.find((a) => isMap(a) && a.get('id') === id) : undefined;
  if (!isMap(found)) throw new Error(`The rules have no ${id} action`);
  return found as YAMLMap;
}

/**
 * The Not Snap rules with these abilities added. `abilities` maps the id each card carries in its `ai`
 * attribute to that card's ability. Every card needs `ai`, `lane` and `handled` attributes (see
 * abilityAttrs). Throws when a piece of code isn't a list of effects.
 */
export function rulesWithAbilities(rules: string, abilities: Map<string, CardAbility>): string {
  if (!abilities.size) return rules;
  const doc = parseDocument(rules);

  // Ongoing: added to lanePower for every card in play with an Ongoing ability.
  const define = doc.get('define') as YAMLMap;
  const mine = ongoing(abilities, 'ongoingMine');
  const theirs = ongoing(abilities, 'ongoingTheirs');
  if (mine) define.set('aiMine', `(self, owner, lane, l) => ${mine}`);
  if (theirs) define.set('aiTheirs', `(self, owner, lane, l) => ${theirs}`);
  if (mine || theirs) {
    const terms = [
      mine && `sum(filter(${inPlay('p')}, c => c.ai != ''), c => aiMine(c, p, c.lane, l))`,
      theirs && `sum(filter(${inPlay('opponent(p)')}, c => c.ai != ''), c => aiTheirs(c, opponent(p), c.lane, l))`,
    ].filter(Boolean);
    define.set('lanePower', `${String(define.get('lanePower')).trim()}\n  + ${terms.join('\n  + ')}`);
  }

  // On Reveal: after the card is placed (and the Forge bonus), then When Destroyed for anything it destroyed.
  const play = action(doc, 'play').get('effects') as YAMLSeq;
  play.items.splice(1, 0, node(doc, { set: { var: 'card.lane', value: 'lane' } }) as never);
  const reveal = dispatch(doc, abilities, 'onReveal');
  if (reveal.length) play.items.push(node(doc, { forEach: { in: '[me]', as: 'owner', do: [{ forEach: { in: '[card]', as: 'self', do: reveal } }] } }) as never);
  play.items.push(node(doc, sweep(doc, abilities)) as never);

  // End of turn: each of the owner's cards in play, before the turn passes.
  const endTurn = action(doc, 'end-turn').get('effects') as YAMLSeq;
  const atEnd = dispatch(doc, abilities, 'endOfTurn');
  if (atEnd.length) {
    endTurn.items.unshift(
      node(doc, {
        forEach: {
          in: '[me]',
          as: 'owner',
          do: [{ forEach: { in: inPlay('me'), as: 'self', do: [{ forEach: { in: '[self.lane]', as: 'lane', do: atEnd } }] } }],
        },
      }) as never,
      node(doc, sweep(doc, abilities)) as never,
    );
  }
  return doc.toString({ lineWidth: 0 });
}

/** The attributes every card needs once abilities are in the rules. */
export const abilityAttrs = (id: string) => ({ ai: id, lane: 0, handled: false });
