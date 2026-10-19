// Shared steps for the composer and draft desk tests: a real Engine (demo, experimental file storage, a temp folder)
// on a synthetic replay transport, the recommended Anthropic pair connected before any vault, and a composed plan.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../../../../runtime/engine.ts';
import type { GitHubTransport, ModelPreset, ModelReplayFixture, ModelTransport } from '../../../../runtime/venture/contracts.ts';
import type { AiOptionsView, AiStatusView, ComposeDecision, ComposedPlan } from '../../../../runtime/venture/onboarding-contracts.ts';
import { replay } from './plans.ts';

export const PASSPHRASE = 'long-enough-passphrase';
export const TEST_KEY = 'sk-ant-test-onboarding-not-a-real-key-7f3a';
export const OPENAI_TEST_KEY = 'sk-openai-test-onboarding-not-a-real-key-91c2';
export const noGitHub: GitHubTransport = { kind: 'fixture', read: async () => ({ status: 404, etag: null, body: '{"message":"Not Found"}', rateRemaining: null }) };

export type EngineOptions = {
  responses?: ModelReplayFixture['responses'];
  transport?: ModelTransport;
  clock?: () => Date;
  claudeCodeTerms?: 'accepted' | 'pending';
  directory?: string;
};

export async function engineFor(t: any, options: EngineOptions = {}): Promise<{ engine: Engine; directory: string }> {
  const directory = options.directory ?? await mkdtemp(join(tmpdir(), 'chausar-onboarding-'));
  const transport = options.transport ?? replay(options.responses ?? []);
  const engine = new Engine({
    directory, demo: true, storage: 'experimental-file',
    venture: {
      host: 'test', modelTransport: transport, githubTransport: noGitHub,
      ...(options.clock ? { clock: options.clock } : {}),
      ...(options.claudeCodeTerms ? { claudeCodeTerms: options.claudeCodeTerms } : {}),
    },
  });
  if (!options.directory) t.after(async () => { await engine.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  return { engine, directory };
}

export function presetOf(options: AiOptionsView, id: ModelPreset['id']): ModelPreset {
  const found = options.presets.find(preset => preset.id === id);
  if (!found) throw new Error(`No preset ${id}`);
  return found;
}

/** The recommended pair: Haiku for quick work, then Sonnet for plans, with one key. */
export async function connectPair(engine: Engine, key = TEST_KEY): Promise<AiStatusView> {
  const options = await engine.request('venture.ai.options', {}) as AiOptionsView;
  await engine.request('venture.ai.connect', { presetId: 'anthropic-haiku-5-5', consentDigest: presetOf(options, 'anthropic-haiku-5-5').consentDigest, apiKey: key });
  return await engine.request('venture.ai.connect', { presetId: 'anthropic-sonnet-5-5', consentDigest: presetOf(options, 'anthropic-sonnet-5-5').consentDigest, apiKey: key }) as AiStatusView;
}

export async function compose(engine: Engine, text: string, countryCode: string): Promise<{ decision: ComposeDecision; plan: ComposedPlan }> {
  const decision = await engine.request('venture.compose.decide', { text, countryCode }) as ComposeDecision;
  const plan = await engine.request('venture.compose.fill', { composeId: decision.composeId }) as ComposedPlan;
  return { decision, plan };
}
