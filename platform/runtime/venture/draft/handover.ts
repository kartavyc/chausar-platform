// Chausar venture launcher, the draft desk: the handover into the vault on venture.create (onboarding spec 2.4).
// Trusted host composition only (engine to venture host to deps), never from a payload. Everything it returns is a
// copy; the keys leave only through moveKeys, and only after the vault write committed.
import { MODEL_PRESET_IDS } from '../contracts.ts';
import type { ModelCallRecord, ModelConnectionRecord, SecretShelf } from '../contracts.ts';
import type { DraftAi, DraftCompose, DraftHandoverPort } from '../onboarding-contracts.ts';
import type { State, StateStore } from '../../contracts.ts';
import type { ComposeSession } from './handlers.ts';

export type HandoverSource = {
  /** The desk's store and shelf, or null when nothing was ever started (or after a clear). */
  parts(): { store: StateStore; shelf: SecretShelf } | null;
  session(): ComposeSession | null;
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
      // paid for, the kept plan names them, and "What was sent" in the vault must list them.
      if (!connections.length && !calls.length) return null;
      return structuredClone({ connections, calls });
    },
    compose(composeId: string): DraftCompose | null {
      const session = source.session();
      if (!session || session.decision.composeId !== composeId || !session.plan || !session.output) return null;
      return structuredClone({ decision: session.decision, decideOutput: session.decideOutput, output: session.output, plan: session.plan });
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
