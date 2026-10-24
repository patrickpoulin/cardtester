import Anthropic from '@anthropic-ai/sdk';

// The rules compiler (Phase 3) will use this client to turn an uploaded rulebook and card list
// into a game definition. Calls go straight from the browser to api.anthropic.com with the
// user's own key; there is no server in between.
export const MODEL = 'claude-opus-5-5';

export function createClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

/** Checks a key by looking up the model, which costs no tokens. */
export async function testApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await createClient(apiKey).models.retrieve(MODEL);
    return { ok: true };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, message: 'That key was rejected. Check it and try again.' };
    if (err instanceof Anthropic.PermissionDeniedError) return { ok: false, message: `This key can't access ${MODEL}.` };
    if (err instanceof Anthropic.RateLimitError) return { ok: false, message: 'Rate limited. Wait a moment and try again.' };
    if (err instanceof Anthropic.APIConnectionError) return { ok: false, message: "Couldn't reach the Claude API. Check your connection." };
    if (err instanceof Anthropic.APIError) return { ok: false, message: `Claude API error ${err.status}: ${err.message}` };
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
