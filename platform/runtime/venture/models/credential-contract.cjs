'use strict';
// Private worker/main contract. Deliberately absent from renderer IPC methods.
const names = new Set(['model:anthropic-haiku-5-5', 'model:anthropic-sonnet-5-5', 'model:openai-gpt-6-luna', 'model:openrouter']);
const failure = code => Object.assign(new Error(code === 'CREDENTIAL_INVALID' ? 'This saved AI connection is invalid. Connect it again.' : 'Protected key storage is unavailable on this computer.'), { code });
function validate(workspaceId, name, value, setting = false) {
  if (typeof workspaceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId) || !names.has(name) || (setting && (typeof value !== 'string' || !value || Buffer.byteLength(value) > 16384))) throw failure('CREDENTIAL_INVALID');
}
module.exports = { validate, failure };
