import { isMap, isSeq, parse, parseDocument, type Document, type YAMLMap, type YAMLSeq } from 'yaml';

/*
 * Card abilities written in plain English on the sheet, turned into Not Snap rules by Claude (see
 * translate.ts). Each ability becomes pieces of rules code, all written against the same names so
 * they can be checked and stored on their own:
 *
 *   self   the card with the ability       owner  the player who has it
 *   lane   the location self is at (1-3; 0 when it isn't in play)
 *
 * Hooks (YAML lists of effects unless noted):
 * - onReveal: after self is played.
 * - ongoingMine / ongoingTheirs (expressions): power self adds to its owner's / the opponent's total
 *   at location `l` while self is in play.
 * - whenDestroyed: when self reaches its owner's destroyed pile, however it got there.
 * - endOfTurn: at the end of each of owner's turns while self is in play.
 * - gameStart: once at the start of the game, wherever self is (usually the deck).
 * - afterCardPlayed: while self is in play, after any other card is played (`played`, by `player`).
 * - whenCardDestroyed: wherever self is (hand, deck or in play), after any other card is destroyed
 *   (`victim`, whose owner is `victimOwner`).
 *
 * The rules also gain, for abilities to use: each player's `lastPlayed` card, `copyReveal` (set it to
 * a card's `ai` to run that card's On Reveal as self's), `revealIds` (the `ai` of every ability with an
 * On Reveal), a `banished` pile per player, and a shared `pool` of cards abilities can create (a
 * sheet's Card Pool tab, shuffled at the start).
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
  gameStart: string;
  afterCardPlayed: string;
  whenCardDestroyed: string;
  /** Why some or all of the text can't be played; empty when it all can. */
  unsupported: string;
}

export const CODE_FIELDS = ['onReveal', 'ongoingMine', 'ongoingTheirs', 'whenDestroyed', 'endOfTurn', 'gameStart', 'afterCardPlayed', 'whenCardDestroyed'] as const;
type StepField = 'onReveal' | 'whenDestroyed' | 'endOfTurn' | 'gameStart' | 'afterCardPlayed' | 'whenCardDestroyed';

/** The same ability text, however it's spaced or capitalized. */
export const abilityKey = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();

/** Whether an ability does anything in the rules. */
export const hasCode = (a: CardAbility) => CODE_FIELDS.some((f) => (a[f] ?? '').trim() !== '');

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

const code = (a: CardAbility, f: (typeof CODE_FIELDS)[number]) => (a[f] ?? '').trim();

/** Effects that run each ability's `field` code for the card whose ai is `key`, with self, owner and lane bound by the caller. */
function dispatch(doc: Document, abilities: Map<string, CardAbility>, field: StepField, key = 'self.ai'): unknown[] {
  const out: unknown[] = [];
  for (const [id, a] of abilities) {
    if (!code(a, field)) continue;
    out.push({ if: `${key} == '${id}'`, then: steps(doc, code(a, field), `${a.text}: ${field}`).toJSON() });
  }
  return out;
}

const idsWith = (abilities: Map<string, CardAbility>, field: (typeof CODE_FIELDS)[number]) => [...abilities].filter(([, a]) => code(a, field)).map(([id]) => id);
const list = (ids: string[]) => `[${ids.map((id) => `'${id}'`).join(', ')}]`;

/** "self.ai == 'a1' ? (e1) : (self.ai == 'a2' ? (e2) : 0)" for one Ongoing side. */
function ongoing(abilities: Map<string, CardAbility>, field: 'ongoingMine' | 'ongoingTheirs'): string | null {
  const parts = [...abilities].filter(([, a]) => code(a, field)).map(([id, a]) => [id, code(a, field)] as const);
  if (!parts.length) return null;
  return parts.reduceRight((rest, [id, expr]) => `(self.ai == '${id}' ? (${expr}) : ${rest})`, '0');
}

const inPlay = (p: string) => `concat(${p}.lane1, ${p}.lane2, ${p}.lane3)`;
const everywhere = (p: string) => `concat(${p}.hand, ${p}.deck, ${p}.lane1, ${p}.lane2, ${p}.lane3)`;

/** Runs `body` for each of `cards` (an expression using `owner`) that has `field` code, for every player as owner, with self and lane bound. */
function forCards(doc: Document, abilities: Map<string, CardAbility>, field: StepField, cards: string): unknown[] {
  const ids = idsWith(abilities, field);
  if (!ids.length) return [];
  return [
    {
      forEach: {
        in: 'players',
        as: 'owner',
        do: [
          {
            forEach: {
              in: `filter(${cards}, c => contains(${list(ids)}, c.ai))`,
              as: 'self',
              do: [{ forEach: { in: '[laneNum(owner, self)]', as: 'lane', do: dispatch(doc, abilities, field) } }],
            },
          },
        ],
      },
    },
  ];
}

// When Destroyed runs for each card in a destroyed pile that hasn't been handled yet, so it works
// however the card was destroyed; then every card watching for destroyed cards gets its turn. An
// ability can destroy more cards, hence the loop.
const UNHANDLED = 'any(players, p => any(p.destroyed, c => not c.handled))';
function sweep(doc: Document, abilities: Map<string, CardAbility>) {
  const watchers = forCards(doc, abilities, 'whenCardDestroyed', `filter(${everywhere('owner')}, c => c.id != victim.id)`);
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
                  ...(watchers.length ? [{ forEach: { in: '[self]', as: 'victim', do: [{ forEach: { in: '[owner]', as: 'victimOwner', do: watchers } }] } }] : []),
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
  const add = (seq: YAMLSeq, ...items: unknown[]) => seq.items.push(...items.map((i) => doc.createNode(i) as never));

  // What abilities can use: zones, player variables and helpers.
  doc.setIn(['zones', 'player', 'banished'], doc.createNode({ visibility: 'public' }));
  doc.setIn(['zones', 'shared', 'pool'], doc.createNode({ visibility: 'hidden' }));
  doc.setIn(['vars', 'player', 'lastPlayed'], null);
  doc.setIn(['vars', 'player', 'copyReveal'], '');
  const define = doc.get('define') as YAMLMap;
  define.set('laneNum', '(p, c) => contains(p.lane1, c) ? 1 : (contains(p.lane2, c) ? 2 : (contains(p.lane3, c) ? 3 : 0))');
  define.set('revealIds', list(idsWith(abilities, 'onReveal')));

  // Ongoing: added to lanePower for every card in play with an Ongoing ability.
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

  // Game Start: after the opening hands are drawn; the pool is shuffled first.
  let setup = doc.get('setup') as YAMLSeq | undefined;
  if (!isSeq(setup)) {
    setup = doc.createNode([]) as YAMLSeq;
    doc.set('setup', setup);
  }
  setup.items.unshift(doc.createNode({ shuffle: 'pool' }) as never);
  add(setup, ...forCards(doc, abilities, 'gameStart', everywhere('owner')), sweep(doc, abilities));

  // On Reveal: after the card is placed (and the Forge bonus); then a copied On Reveal, cards that
  // react to a card being played, and When Destroyed for anything destroyed along the way.
  const play = action(doc, 'play').get('effects') as YAMLSeq;
  play.items.splice(1, 0, doc.createNode({ set: { var: 'card.lane', value: 'lane' } }) as never);
  const reveal = dispatch(doc, abilities, 'onReveal');
  const copied = dispatch(doc, abilities, 'onReveal', 'revealAs');
  const asSelf = (body: unknown[]) => ({ forEach: { in: '[me]', as: 'owner', do: [{ forEach: { in: '[card]', as: 'self', do: body } }] } });
  if (reveal.length) add(play, asSelf(reveal));
  if (copied.length)
    add(play, {
      if: "me.copyReveal != ''",
      then: [
        { forEach: { in: '[me.copyReveal]', as: 'revealAs', do: [{ set: { var: 'me.copyReveal', value: "''" } }, asSelf(copied)] } },
      ],
    });
  add(play, sweep(doc, abilities));
  const reactions = forCards(doc, abilities, 'afterCardPlayed', `filter(${inPlay('owner')}, c => c.id != played.id)`);
  if (reactions.length) add(play, { forEach: { in: '[card]', as: 'played', do: [{ forEach: { in: '[me]', as: 'player', do: reactions } }] } }, sweep(doc, abilities));
  add(play, { set: { var: 'me.lastPlayed', value: 'card' } });

  // End of turn: each of the owner's cards in play, before the turn passes.
  const endTurn = action(doc, 'end-turn').get('effects') as YAMLSeq;
  const atEnd = dispatch(doc, abilities, 'endOfTurn');
  if (atEnd.length) {
    endTurn.items.unshift(
      doc.createNode({
        forEach: {
          in: '[me]',
          as: 'owner',
          do: [{ forEach: { in: inPlay('me'), as: 'self', do: [{ forEach: { in: '[laneNum(owner, self)]', as: 'lane', do: atEnd } }] } }],
        },
      }) as never,
      doc.createNode(sweep(doc, abilities)) as never,
    );
  }
  return doc.toString({ lineWidth: 0 });
}

/** The attributes every card needs once abilities are in the rules. */
export const abilityAttrs = (id: string) => ({ ai: id, lane: 0, handled: false });
