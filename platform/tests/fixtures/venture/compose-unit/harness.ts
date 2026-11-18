// Shared steps for the draft desk and plan tests: a real Engine (demo, experimental file storage, a temp folder)
// on a synthetic replay transport, the recommended Anthropic pair connected before any vault, and a business made the
// way the first run makes one.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../../../../runtime/engine.ts';
import type { BlueprintView, GitHubTransport, ModelPreset, ModelReplayFixture, ModelTransport } from '../../../../runtime/venture/contracts.ts';
import type { AiOptionsView, AiStatusView } from '../../../../runtime/venture/onboarding-contracts.ts';
import { replay } from './plans.ts';

export const PASSPHRASE = 'long-enough-passphrase';
export const TEST_KEY = ("sk" + "-ant-test-onboarding-not-a-real-key-7f3a");
export const OPENAI_TEST_KEY = ("sk" + "-openai-test-onboarding-not-a-real-key-91c2");
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

/**
 * The built-in interview, answered as the first run answers it (app/ui/src/places/onboarding/flow.ts): the first way
 * to charge, no tax, the rest skipped. answers: an answer to give a question in place of that, by question id.
 */
export async function answerInterview(engine: Engine, answers: Record<string, unknown> = {}): Promise<void> {
  let view = await engine.request('venture.interview.next', { useTemplate: true }) as any;
  const asked = new Set<string>();
  for (let guard = 0; guard < 12; guard++) {
    const question = view.interview.questions.find((q: any) => q.answer === null && !asked.has(q.id));
    if (!question) break;
    asked.add(question.id);
    const answer = answers[question.id] ?? (question.id === 'q_pricing_model' ? { choiceId: question.choices[0].id }
      : question.id === 'q_tax' ? { yes: false }
        : question.id === 'q_tax_rate' ? { rate: question.prefill }
          : { skipped: true });
    view = await engine.request('venture.interview.answer', { questionId: question.id, answer });
  }
}

/**
 * A business made the way the first run makes one: the vault, venture.create from the idea and the country, the
 * built-in interview, then the first plan. draft: what venture.blueprint.draft takes; the built-in words when left out,
 * and {} asks the connected AI for the words.
 */
export async function business(engine: Engine, input: { name: string; idea: string; countryCode: string; answers?: Record<string, unknown>; draft?: Record<string, unknown> }): Promise<BlueprintView> {
  await engine.request('workspace.create', { name: input.name, passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('venture.create', { idea: input.idea, countryCode: input.countryCode, workingName: input.name });
  await answerInterview(engine, input.answers);
  return await engine.request('venture.blueprint.draft', input.draft ?? { useTemplate: true }) as BlueprintView;
}
