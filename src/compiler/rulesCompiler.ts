import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { z } from 'zod';
import { GameDefinitionError, loadGame } from '../dsl/compile';
import { smokeTest } from '../dsl/smoke';
import type { AnyGame } from '../engine/types';
import { MODEL } from './claude';
import type { SourceFile } from './files';
import { REPLY_SCHEMA, SYSTEM_PROMPT } from './prompt';

/*
 * Turns uploaded rules (and optionally a card list) into a game.yaml with Claude, then checks the
 * result with the validator and test games, sending any problems back for Claude to fix. The
 * conversation is only ever appended to, so earlier turns stay cached and valid.
 */

export interface Question {
  id: string;
  question: string;
  options: string[];
  assumed: string;
}

export interface CompileResult {
  summary: string;
  yaml: string;
  /** Open questions about the rules, each with the option the file currently assumes. */
  questions: Question[];
  /** The compiled game when the file passed validation and test play. */
  game: AnyGame | null;
  /** Problems still left after the fix attempts (empty when `game` is set). */
  problems: string[];
}

export type Status =
  | { step: 'writing'; chars: number }
  | { step: 'checking' }
  | { step: 'fixing'; attempt: number; problems: number; chars: number };

export interface Usage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export type RequestParams = MessageCreateParamsNonStreaming;
/** Sends one request and reports how many characters of the reply have arrived. */
export type Transport = (params: RequestParams, onText: (chars: number) => void, signal?: AbortSignal) => Promise<BetaMessage>;

export class CompileError extends Error {}

const MAX_FIX_ATTEMPTS = 3;

const ReplySchema = z.object({
  summary: z.string(),
  yaml: z.string(),
  questions: z.array(z.object({ id: z.string(), question: z.string(), options: z.array(z.string()), assumed: z.string() })),
});

export class RulesCompiler {
  private readonly messages: BetaMessageParam[] = [];
  readonly usage: Usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };

  constructor(
    private readonly transport: Transport,
    private readonly onStatus: (status: Status) => void = () => {},
    private readonly signal?: AbortSignal,
  ) {}

  /** First pass: read the rules and card list and write the file. */
  async start(rules: SourceFile[], cards: SourceFile | null): Promise<CompileResult> {
    if (rules.length === 0) throw new CompileError('Add at least one rules file.');
    const content: BetaContentBlockParam[] = rules.map((f) => documentBlock(f, `Rules: ${f.name}`));
    if (cards) content.push(documentBlock(cards, `Card list: ${cards.name}`));
    content.push({
      type: 'text',
      text: cards
        ? 'Write the game file for this game, using the rules and the card list above.'
        : 'Write the game file for this game, using the rules above.',
    });
    return this.turn(content);
  }

  /** Rebuilds the file with the designer's answers to the open questions. */
  async answer(questions: Question[], answers: Record<string, string>): Promise<CompileResult> {
    const lines = questions.map((q) => `- ${q.question} → ${answers[q.id] ?? q.assumed}`);
    return this.turn([{ type: 'text', text: `Here are my answers. Update the file so it matches all of them.\n${lines.join('\n')}` }]);
  }

  private async turn(content: BetaContentBlockParam[]): Promise<CompileResult> {
    let reply = await this.send(content, (chars) => this.onStatus({ step: 'writing', chars }));
    const questions = reply.questions;
    for (let attempt = 1; ; attempt++) {
      this.onStatus({ step: 'checking' });
      const { game, problems } = check(reply.yaml);
      if (game || attempt > MAX_FIX_ATTEMPTS) return { summary: reply.summary, yaml: reply.yaml, questions, game, problems };
      const fix = `The file has problems found by the validator or by test games played from it:\n${problems.map((p) => `- ${p}`).join('\n')}\n\nFix them and return the complete corrected file.`;
      reply = await this.send([{ type: 'text', text: fix }], (chars) => this.onStatus({ step: 'fixing', attempt, problems: problems.length, chars }));
    }
  }

  private async send(content: BetaContentBlockParam[], onText: (chars: number) => void): Promise<z.infer<typeof ReplySchema>> {
    this.messages.push({ role: 'user', content });
    const params: RequestParams = {
      model: MODEL,
      // The model's full output limit: thinking counts against it too, and a big card list makes a long file.
      max_tokens: 128000,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      // Caches the conversation so far, so follow-up turns don't pay again for the rulebook.
      cache_control: { type: 'ephemeral' },
      messages: this.messages,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: { type: 'json_schema', schema: REPLY_SCHEMA } },
      // If a safety classifier declines, the API retries on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    };
    const message = await this.transport(params, onText, this.signal);
    this.messages.push({ role: 'assistant', content: message.content });

    this.usage.inputTokens += message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0);
    this.usage.cachedInputTokens += message.usage.cache_read_input_tokens ?? 0;
    this.usage.outputTokens += message.usage.output_tokens;

    if (message.stop_reason === 'refusal') {
      throw new CompileError("Claude declined to process these files. Check that they're the game's rules and card list.");
    }
    if (message.stop_reason === 'max_tokens') {
      throw new CompileError('The game is too large to write in one reply. Try splitting the card list or trimming the rulebook.');
    }
    const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new CompileError("Claude's reply couldn't be read. Try again.");
    }
    const reply = ReplySchema.safeParse(parsed);
    if (!reply.success) throw new CompileError("Claude's reply was missing parts. Try again.");
    return reply.data;
  }
}

function documentBlock(file: SourceFile, title: string): BetaContentBlockParam {
  return file.kind === 'pdf'
    ? { type: 'document', title, source: { type: 'base64', media_type: 'application/pdf', data: file.base64 } }
    : { type: 'document', title, source: { type: 'text', media_type: 'text/plain', data: file.text } };
}

/** Validates the file and test-plays it. */
export function check(yaml: string): { game: AnyGame | null; problems: string[] } {
  let game: AnyGame;
  try {
    game = loadGame(yaml);
  } catch (err) {
    return { game: null, problems: err instanceof GameDefinitionError ? err.issues : [err instanceof Error ? err.message : String(err)] };
  }
  const problems = smokeTest(game);
  return problems.length ? { game: null, problems } : { game, problems: [] };
}
