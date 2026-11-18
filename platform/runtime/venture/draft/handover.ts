// Chausar venture launcher, the draft desk: the handover into the vault on venture.create (onboarding spec 2.4).
// Trusted host composition only (engine to venture host to deps), never from a payload. Everything it returns is a
// copy; the keys leave only through moveKeys, and only after the vault write committed.
import { MODEL_PRESET_IDS } from '../contracts.ts';
import type { ModelCallRecord, ModelConnectionRecord, SecretShelf } from '../contracts.ts';
import type { DraftAi, DraftHandoverPort } from '../onboarding-contracts.ts';
import type { AiSetupNote } from '../models/ai-setup.ts';
import type { State, StateStore } from '../../contracts.ts';

export type HandoverSource = {
  /** The desk's store and shelf, or null when nothing was ever started (or after a clear). */
  parts(): { store: StateStore; shelf: SecretShelf } | null;
  /** The setup venture.ai.reuse connected in this draft, or null. */
  reused(): AiSetupNote | null;
  clear(): void;
};

function records<K extends 'venture-model-connection' | 'venture-model-call'>(state: State, kind: K) {
  return state.conversations.filter(record => record?.kind === kind) as (K extends 'venture-model-connection' ? ModelConnectionRecord : ModelCallRecord)[];
}

export function createHandover(source: HandoverSource): DraftHandoverPort {
  return Object.freeze({
    ai(): DraftAi | null {
      const parts = source.parts();
      if (!parts) return null;
      const state = parts.store.read();
      const connections = records(state, 'venture-model-connection').filter(connection => connection.status === 'connected');
      const calls = records(state, 'venture-model-call');
      // Calls made before the vault go along even when every connection was disconnected since: they were sent and
      // paid for, and "What was sent" in the vault must list them.
      if (!connections.length && !calls.length) return null;
      // The reused setup counts only while one of its own connections is still connected (the owner may have
      // disconnected it in the draft and connected something else).
      const note = source.reused();
      const reused = note && connections.some(connection => note.connections.some(item => item.presetId === connection.presetId && item.consentedAt === connection.consentedAt)) ? note : null;
      return structuredClone({ connections, calls, ...(reused ? { reused } : {}) });
    },
    moveKeys(target: SecretShelf): void {
      const parts = source.parts();
      if (!parts) return;
      for (const id of MODEL_PRESET_IDS) {
        const value = parts.shelf.get(`model:${id}`);
        if (value !== null) target.set(`model:${id}`, value);
      }
    },
    settle(): void { source.clear(); },
  });
}
