'use strict';
const { validate } = require('../../platform/runtime/venture/models/credential-contract.cjs');
function createCredentialRelay(harness, child, { timeoutMs = 10000 } = {}) {
  const waiting = new Map(); let closed = false;
  function answer(callId, result) {
    const timer = waiting.get(callId); if (!timer) return; clearTimeout(timer); waiting.delete(callId);
    const reply = result?.ok === true && (result.value === null || typeof result.value === 'string' && Buffer.byteLength(result.value) <= 16384)
      ? { ok: true, value: result.value } : { ok: false, code: result?.code === 'CREDENTIAL_INVALID' ? 'CREDENTIAL_INVALID' : 'CREDENTIAL_UNAVAILABLE' };
    if (!closed && child.connected) try { child.send({ kind: 'host-credential-result', callId, ...reply }, () => {}); } catch { /* worker channel owns failure */ }
  }
  return {
    receive(message) {
      if (closed || !message || typeof message !== 'object' || Array.isArray(message) || message.kind !== 'host-credential' || Object.hasOwn(message, 'id') || typeof message.callId !== 'string' || !/^[a-f0-9-]{36}$/.test(message.callId) || !['get', 'set', 'delete'].includes(message.op) || waiting.has(message.callId) || waiting.size >= 32) return;
      const expected = message.op === 'set' ? 'callId,kind,name,op,value,workspaceId' : 'callId,kind,name,op,workspaceId';
      if (Object.keys(message).sort().join(',') !== expected) return;
      waiting.set(message.callId, setTimeout(() => answer(message.callId, null), timeoutMs));
      try { validate(message.workspaceId, message.name, message.value, message.op === 'set'); }
      catch { answer(message.callId, { code: 'CREDENTIAL_INVALID' }); return; }
      if (!harness.listenerCount('credential')) { answer(message.callId, null); return; }
      try { harness.emit('credential', Object.freeze({ op: message.op, workspaceId: message.workspaceId, name: message.name, ...(message.op === 'set' ? { value: message.value } : {}) }), result => answer(message.callId, result)); }
      catch { answer(message.callId, null); }
    },
    close() { closed = true; for (const timer of waiting.values()) clearTimeout(timer); waiting.clear(); },
  };
}
module.exports = { createCredentialRelay };
