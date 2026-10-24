import Anthropic from '@anthropic-ai/sdk';
import type { Transport } from './rulesCompiler';

// Calls go straight from the browser to api.anthropic.com with the user's own key; there is no
// server in between.
export const MODEL = 'claude-opus-5-5';

export function createClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

/** Streams each request (long replies would otherwise hit HTTP timeouts) and returns the final message. */
export function sdkTransport(apiKey: string): Transport {
  const client = createClient(apiKey);
  return async (params, onText, signal) => {
    const stream = client.beta.messages.stream(params, { signal });
    let chars = 0;
    stream.on('text', (delta) => onText((chars += delta.length)));
    return stream.finalMessage();
  };
}

/** A sentence for the user describing why an API call failed. */
export function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.APIUserAbortError) return 'Stopped.';
  if (err instanceof Anthropic.AuthenticationError) return 'Your Claude API key was rejected. Check it under Settings.';
  if (err instanceof Anthropic.PermissionDeniedError) return `Your API key can't use ${MODEL}.`;
  if (err instanceof Anthropic.RateLimitError) return 'Claude is rate-limiting this key. Wait a minute and try again.';
  if (err instanceof Anthropic.BadRequestError) return `Claude couldn't accept the request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the Claude API. Check your connection.";
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

/** Checks a key by looking up the model, which costs no tokens. */
export async function testApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await createClient(apiKey).models.retrieve(MODEL);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: describeApiError(err) };
  }
}
