import { describe, expect, it } from 'vitest';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { CompileError, RulesCompiler, type Question, type RequestParams, type Status } from '../src/compiler/rulesCompiler';
import { SYSTEM_PROMPT } from '../src/compiler/prompt';

const GOOD = `
id: race
name: Race
players: { min: 2, max: 4 }
cards:
  - deck: standard52
zones:
  shared: { deck: {} }
  player: { hand: {} }
actions:
  - id: draw
    effects:
      - draw: { from: deck, to: me.hand }
endWhen: "any(players, p => len(p.hand) >= 3)"
winners: "filter(players, p => len(p.hand) >= 3)"
`;
const BROKEN = GOOD.replace('to: me.hand', 'to: me.hnd');

const QUESTION: Question = { id: 'tie', question: 'Who wins a tie?', options: ['Shared win', 'Fewest cards'], assumed: 'Shared win' };

function message(reply: object | string, stop: BetaMessage['stop_reason'] = 'end_turn'): BetaMessage {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: typeof reply === 'string' ? reply : JSON.stringify(reply) },
    ],
    stop_reason: stop,
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 10 },
  } as unknown as BetaMessage;
}

/** A fake Claude that returns the given replies in order and records each request. */
function fake(...replies: BetaMessage[]) {
  const requests: RequestParams[] = [];
  const transport = async (params: RequestParams, onText: (n: number) => void) => {
    requests.push(structuredClone(params));
    onText(42);
    const next = replies.shift();
    if (!next) throw new Error('no more replies');
    return next;
  };
  return { transport, requests };
}

const rules = [{ name: 'rules.pdf', kind: 'pdf' as const, base64: 'JVBERi0=' }];
const cards = { name: 'cards.csv', kind: 'text' as const, text: 'name,count\nAce,4' };

describe('rules compiler', () => {
  it('sends the rules and card list and returns a playable game', async () => {
    const { transport, requests } = fake(message({ summary: 'A race.', yaml: GOOD, questions: [QUESTION] }));
    const statuses: Status[] = [];
    const result = await new RulesCompiler(transport, (s) => statuses.push(s)).start(rules, cards);

    expect(result.game?.name).toBe('Race');
    expect(result.problems).toEqual([]);
    expect(result.questions).toEqual([QUESTION]);
    expect(statuses).toEqual([{ step: 'writing', chars: 42 }, { step: 'checking' }]);

    const req = requests[0];
    expect(req.model).toBe('claude-opus-5-5');
    expect(req.system).toEqual([{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }]);
    expect(req.fallbacks).toBe('default');
    expect(req.betas).toEqual(['server-side-fallback-2026-07-01']);
    const content = req.messages[0].content as { type: string; title?: string; source?: { type: string } }[];
    expect(content.map((b) => [b.type, b.title, b.source?.type])).toEqual([
      ['document', 'Rules: rules.pdf', 'base64'],
      ['document', 'Card list: cards.csv', 'text'],
      ['text', undefined, undefined],
    ]);
  });

  it('sends validation and test-play problems back until the file works', async () => {
    const { transport, requests } = fake(
      message({ summary: 'v1', yaml: BROKEN, questions: [QUESTION] }),
      message({ summary: 'v2', yaml: GOOD, questions: [] }),
    );
    const statuses: Status[] = [];
    const result = await new RulesCompiler(transport, (s) => statuses.push(s)).start(rules, null);

    expect(result.game).not.toBeNull();
    expect(result.summary).toBe('v2');
    expect(result.questions).toEqual([QUESTION]); // open questions survive the fix turn
    const fixRequest = requests[1].messages.at(-1)!.content as { text: string }[];
    expect(fixRequest[0].text).toMatch(/draw\.to: expected a zone/);
    expect(statuses).toContainEqual({ step: 'fixing', attempt: 1, problems: 1, chars: 42 });
  });

  it('gives up after three fix attempts and reports what is still wrong', async () => {
    const broken = () => message({ summary: 's', yaml: BROKEN, questions: [] });
    const { transport, requests } = fake(broken(), broken(), broken(), broken());
    const result = await new RulesCompiler(transport).start(rules, null);
    expect(requests).toHaveLength(4);
    expect(result.game).toBeNull();
    expect(result.problems[0]).toMatch(/expected a zone/);
  });

  it('sends answers as a new turn and keeps the conversation append-only', async () => {
    const first = message({ summary: 's', yaml: GOOD, questions: [QUESTION] });
    const { transport, requests } = fake(first, message({ summary: 's2', yaml: GOOD, questions: [] }));
    const compiler = new RulesCompiler(transport);
    const r1 = await compiler.start(rules, null);
    const r2 = await compiler.answer(r1.questions, { tie: 'Fewest cards' });

    expect(r2.questions).toEqual([]);
    const second = requests[1].messages;
    expect(second).toHaveLength(3);
    expect(second[0]).toEqual(requests[0].messages[0]);
    expect(second[1]).toEqual({ role: 'assistant', content: first.content }); // thinking block passed back unchanged
    expect((second[2].content as { text: string }[])[0].text).toContain('Who wins a tie? → Fewest cards');
    expect(compiler.usage).toEqual({ inputTokens: 220, cachedInputTokens: 2000, outputTokens: 100 });
  });

  it('explains refusals, truncated replies and unreadable replies', async () => {
    await expect(new RulesCompiler(fake(message('', 'refusal')).transport).start(rules, null)).rejects.toThrow(CompileError);
    await expect(new RulesCompiler(fake(message('{"summ', 'max_tokens')).transport).start(rules, null)).rejects.toThrow(/too large/);
    await expect(new RulesCompiler(fake(message('not json')).transport).start(rules, null)).rejects.toThrow(/couldn't be read/);
    await expect(new RulesCompiler(fake().transport).start([], null)).rejects.toThrow(/at least one rules file/);
  });

  it('keeps the system prompt free of anything that changes between requests', () => {
    expect(SYSTEM_PROMPT).toContain('<format_reference>');
    expect(SYSTEM_PROMPT).toContain('id: deck-builder');
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});
