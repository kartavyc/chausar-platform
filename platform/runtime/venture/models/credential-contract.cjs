'use strict';
// Private worker/main contract. Deliberately absent from renderer IPC methods.
// Wave 6 (6D3): the owner's own Razorpay key id and secret, saved together (money/billing.ts RAZORPAY_CREDENTIAL).
// Wave 6 (6F6): the owner's own Telegram bot token and chat id, saved together (notify/telegram.ts TELEGRAM_CREDENTIAL).
const names = new Set(['model:anthropic-haiku-5-5', 'model:anthropic-sonnet-5-5', 'model:openai-gpt-6-luna', 'model:openrouter', 'payments:razorpay', 'alerts:telegram',
  // Wave 6 (6F3): the owner's own web search key (web/search.ts); 6F8: their own people search keys (people/services.ts).
  'search:brave', 'search:exa', 'search:tavily', 'people:happenstance', 'people:probe42',
  // A2 review: the key that seals the owner's choice of Codex (platform/runtime/codex-trust.ts), host scope only.
  'trust:codex-seal']);
/** A2 second review: the seal key lives only under the host's own scope, never a business workspace. */
const HOST_ONLY = Object.freeze({ 'trust:codex-seal': 'chausar-host' });
// CREDENTIAL_NO_STORE (A2 second review): this computer has no protected store at all (no safeStorage, or no keyring on
// Linux). It is told apart from CREDENTIAL_UNAVAILABLE (a store that failed, timed out or did not answer) only for the
// Codex seal; every other caller sees CREDENTIAL_UNAVAILABLE, with the same words.
const failure = code => Object.assign(new Error(code === 'CREDENTIAL_INVALID' ? 'This saved AI connection is invalid. Connect it again.' : 'Protected key storage is unavailable on this computer.'), { code });
function validate(workspaceId, name, value, setting = false) {
  if (typeof workspaceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId) || !(names.has(name) || typeof name === 'string' && /^mcp:[A-Za-z0-9_-]{1,128}:[a-z][a-z0-9_-]{0,63}$/.test(name)) || (Object.hasOwn(HOST_ONLY, name) && HOST_ONLY[name] !== workspaceId) || (setting && (typeof value !== 'string' || !value || Buffer.byteLength(value) > 16384))) throw failure('CREDENTIAL_INVALID');
}
module.exports = { validate, failure };
