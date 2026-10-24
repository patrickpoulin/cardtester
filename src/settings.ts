// The API key lives only in this browser's localStorage. Storage can be unavailable
// (private windows, blocked site data), so every access is guarded.
const KEY = 'cardtester.anthropicApiKey';

export function loadApiKey(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveApiKey(value: string): boolean {
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
