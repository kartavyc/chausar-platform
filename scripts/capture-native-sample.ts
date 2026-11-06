/** Developer live-check setup. Every record is synthetic and the only tool route is the explicitly named Codex. */
import { CodexDriver } from '../platform/runtime/venture/agent-runtime/codex-driver.ts';
import { setup, seedBlueprint, seedOrder, owner } from '../platform/tests/venture-views-env.ts';
import { ventureAction } from '../platform/runtime/venture/records.ts';
import { getClientAiConsent, agreeClientAiConsent } from '../platform/runtime/venture/clients/ai-consent.ts';
import { presetSpec } from '../platform/runtime/venture/models/presets.ts';
import type { Engine } from '../platform/runtime/engine.ts';

export function sampleCodexRoute(executable: string) {
  return async () => ({ driver: new CodexDriver({ executable }), presetId: 'codex-cli' as const,
    settings: { model: 'gpt-6-luna', effort: 'high' as const, autoReview: true, network: false, shell: false, webSearch: false, connectors: false } });
}
export async function prepareNativeSample(engine: Engine): Promise<string> {
  const env = await setup();
  const { client, order } = await seedOrder(env, await seedBlueprint(env));
  await env.deps.services.trust.updatePolicy(owner, { send: 'shape' });
  await ventureAction(env.deps, owner, 'admin', 'sample.prepare', tx => {
    tx.touch({ launchStage: 'approve-each' }); tx.replace({ ...client, email: null });
    tx.put({ ...tx.base('venture-model-connection'), presetId: 'codex-cli', routeKind: 'codex-cli', model: 'gpt-6-luna', endpoint: null, tiers: ['fast', 'main'], consentDigest: presetSpec('codex-cli').consentDigest, consentedAt: env.now(), monthlyCapMicros: '5000000', status: 'connected' } as never);
  });
  const consent = await getClientAiConsent(env.deps, owner, { clientId: client.id });
  await agreeClientAiConsent(env.deps, owner, { clientId: client.id, disclosureDigest: consent.disclosureDigest });
  const state = env.store.read(); state.workspace = engine.vault!.read().workspace;
  await engine.vault!.restoreCaptureState(state);
  return order.id;
}
