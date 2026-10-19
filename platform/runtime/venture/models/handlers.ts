// Chausar venture launcher, package P2 (models): the five RPC handlers.
// Keys go to the memory-only SecretShelf before the write and never into a record, a log or an error.
import { authorize, check, type Context } from '../../contracts.ts';
import { MODEL_PRESET_IDS, MODEL_PURPOSES } from '../contracts.ts';
import type { ModelPresetId, ModelPurpose, ModelStatusView, ModelTier, VentureDeps, VentureHandlerTable, VentureResults } from '../contracts.ts';
import { currentVenture, exactPayload, identifier, requireAppChannel, requireVenture, smallInteger, ventureAction } from '../records.ts';
import { monthlyCapMicros } from './cost.ts';
import { listCalls, newestFirst, putRecord, replaceRecord, viewCall } from './port.ts';
import { AVAILABILITY_REASONS, claudeTermsOpen, endpointFor, presetSpec } from './presets.ts';
import type { ConnectionRecord } from './types.ts';

const SECRET = (id: ModelPresetId) => `model:${id}` as const;
const MODEL_ID = /^[a-z0-9][a-z0-9.-]{1,63}$/;

async function presets(deps: VentureDeps, ctx: Context, payload: unknown): Promise<VentureResults['venture.models.presets']> {
  exactPayload(payload, []);
  authorize(deps.store, ctx);
  return deps.models.presets();
}

export type ConnectOptions = { draft?: boolean };

/**
 * venture.models.connect, and the same checks for venture.ai.connect before the vault (options.draft: the draft
 * desk's own in-memory store and shelf). Before the vault no AI is the absence of a connection, so built-in
 * templates are refused there. Claude Code is refused while the terms gate is pending, in both places.
 */
export async function connectModel(deps: VentureDeps, ctx: Context, payload: unknown, options: ConnectOptions = {}): Promise<ModelStatusView> {
  const input = exactPayload(payload, ['presetId', 'consentDigest', 'apiKey', 'model', 'tiers', 'monthlyCapUsd'], ['presetId', 'consentDigest']);
  authorize(deps.store, ctx, 'admin');
  requireAppChannel(ctx, 'venture.models.connect');
  requireVenture(deps.store.read());
  check((MODEL_PRESET_IDS as readonly unknown[]).includes(input.presetId), 'INVALID_VENTURE_REQUEST', 'Choose one of the listed AI options.');
  const presetId = input.presetId as ModelPresetId;
  check(!(options.draft && presetId === 'built-in-templates'), 'INVALID_VENTURE_REQUEST', 'Built-in templates need no connection. Continue without AI instead.');
  const spec = presetSpec(presetId);
  check(!(deps.host === 'hosted-web' && spec.runsOn === 'this-computer'), 'PRESET_UNAVAILABLE', AVAILABILITY_REASONS.hostedCli);
  check(presetId !== 'claude-code-cli' || claudeTermsOpen(deps.claudeCodeTerms), 'PRESET_UNAVAILABLE', AVAILABILITY_REASONS.claudeTerms);
  const live = deps.models.presets().find(preset => preset.id === presetId);
  check(live && live.availability !== 'unavailable', 'PRESET_UNAVAILABLE', live?.availabilityReason ?? 'This AI option is not available here.');
  check(presetId !== 'codex-cli' || live.availability !== 'needs-setup', 'PRESET_UNAVAILABLE', live.availabilityReason);

  check(typeof input.consentDigest === 'string' && input.consentDigest === spec.consentDigest, 'MODEL_CONSENT_REQUIRED', 'Read and accept what this connection sends before connecting.');
  let apiKey: string | null = null;
  if (spec.needsKey) {
    check(typeof input.apiKey === 'string' && input.apiKey.length >= 20 && input.apiKey.length <= 400 && !/\s/.test(input.apiKey), 'INVALID_VENTURE_REQUEST', 'Paste the whole key, with no spaces.');
    apiKey = input.apiKey;
  } else {
    check(input.apiKey === undefined, 'INVALID_VENTURE_REQUEST', 'This option does not use a key. Leave the key empty.');
  }
  let model = spec.model;
  if (input.model !== undefined) {
    check(spec.modelEditable, 'INVALID_VENTURE_REQUEST', 'Only GPT-6 Luna takes a typed model id.');
    check(typeof input.model === 'string' && MODEL_ID.test(input.model), 'INVALID_VENTURE_REQUEST', 'Type the model id your account shows, in lower case, like gpt-6-luna.');
    model = input.model;
  }
  let tiers: ModelTier[] = [...spec.tiers];
  if (input.tiers !== undefined) {
    check(Array.isArray(input.tiers) && input.tiers.length > 0 && input.tiers.every(tier => spec.tiers.includes(tier as ModelTier)), 'INVALID_VENTURE_REQUEST', 'Choose which jobs this connection does from the ones it suggests.');
    tiers = spec.tiers.filter(tier => (input.tiers as unknown[]).includes(tier));
  }
  const capMicros = input.monthlyCapUsd === undefined ? '5000000' : monthlyCapMicros(input.monthlyCapUsd);

  if (presetId === 'claude-code-cli') await deps.models.checkCli('claude-code-cli');

  const secretName = SECRET(presetId);
  const previousKey = apiKey !== null ? deps.secrets.get(secretName) : null;
  if (apiKey !== null) deps.secrets.set(secretName, apiKey);
  try {
    await ventureAction(deps, ctx, 'admin', 'models.connect', tx => {
      for (const older of tx.list('venture-model-connection')) {
        if (older.presetId === presetId && older.status === 'connected') replaceRecord(tx, { ...older, status: 'disconnected' as const });
      }
      const connection: ConnectionRecord = {
        ...tx.base('venture-model-connection'), presetId, routeKind: spec.kind, model, endpoint: endpointFor(spec), tiers,
        consentDigest: spec.consentDigest, consentedAt: tx.now, monthlyCapMicros: spec.kind === 'template' ? '0' : capMicros, status: 'connected',
      };
      putRecord(tx, connection);
      tx.emit('model-connected', { presetId, tiers });
    });
  } catch (error) {
    if (apiKey !== null) {
      if (previousKey !== null) deps.secrets.set(secretName, previousKey);
      else deps.secrets.delete(secretName);
    }
    throw error;
  }

  // After the commit, never inside it: the trust service writes in its own transaction. (The draft store sends shapes already.)
  if (!options.draft && spec.kind !== 'template' && deps.store.read().policy.send === 'nothing') {
    await deps.services.trust.updatePolicy(ctx, { send: 'shape' });
    await ventureAction(deps, ctx, 'admin', 'models.send-policy', tx => { tx.emit('send-policy-changed', { from: 'nothing', to: 'shape' }); });
  }
  return deps.models.status(ctx);
}

async function connect(deps: VentureDeps, ctx: Context, payload: unknown): Promise<VentureResults['venture.models.connect']> {
  return connectModel(deps, ctx, payload);
}

export async function disconnect(deps: VentureDeps, ctx: Context, payload: unknown): Promise<VentureResults['venture.models.disconnect']> {
  const input = exactPayload(payload, ['connectionId'], ['connectionId']);
  const connectionId = identifier(input.connectionId, 'connectionId');
  const result = await ventureAction(deps, ctx, 'admin', 'models.disconnect', tx => {
    const connection = tx.find('venture-model-connection', connectionId);
    check(connection, 'INVALID_VENTURE_REQUEST', 'This AI connection was not found.');
    if (connection.status === 'connected') {
      replaceRecord(tx, { ...connection, status: 'disconnected' as const });
      tx.emit('model-disconnected', { presetId: connection.presetId, connectionId });
    }
    const stillUsed = tx.list('venture-model-connection')
      .some(item => item.id !== connection.id && item.presetId === connection.presetId && item.status === 'connected');
    return { presetId: connection.presetId, stillUsed };
  });
  if (!result.stillUsed && presetSpec(result.presetId).needsKey) deps.secrets.delete(SECRET(result.presetId));
  return deps.models.status(ctx);
}

export async function status(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ModelStatusView> {
  exactPayload(payload, []);
  return deps.models.status(ctx);
}

/** The "What was sent" list: newest first, with the full stored payload text. Never writes. */
export async function calls(deps: VentureDeps, ctx: Context, payload: unknown): Promise<VentureResults['venture.models.calls']> {
  const input = exactPayload(payload, ['limit', 'purpose']);
  const limit = input.limit === undefined ? 20 : smallInteger(input.limit, 'limit', 1, 100);
  let purpose: ModelPurpose | null = null;
  if (input.purpose !== undefined) {
    check((MODEL_PURPOSES as readonly unknown[]).includes(input.purpose), 'INVALID_VENTURE_REQUEST', 'Choose a known purpose.');
    purpose = input.purpose as ModelPurpose;
  }
  authorize(deps.store, ctx);
  const state = deps.store.read();
  const venture = currentVenture(state);
  if (!venture) return [];
  const nowMs = deps.clock().getTime();
  const list = newestFirst(listCalls(state, venture.id).filter(call => purpose === null || call.purpose === purpose))
    .slice(0, limit)
    .map(call => viewCall(call, nowMs));
  return list;
}

export const handlers: VentureHandlerTable = {
  'venture.models.presets': presets,
  'venture.models.connect': connect,
  'venture.models.disconnect': disconnect,
  'venture.models.status': status,
  'venture.models.calls': calls,
};
