// Shared by the C7 routine tests: a business whose chat runs on the owner's Codex plan, with its connection checked and
// the chat consent given, and (optionally) Claude Code connected beside it as a possible backup. The test model port's
// previews name the AI the call would really go to: the routine's backup when the run is on one, else the main tier.
import assert from 'node:assert/strict';
import type { ConnectorCheckRecord, ModelConnectionView, RoutineInput } from '../runtime/venture/contracts.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import { chatRoute } from '../runtime/venture/agents/consent.ts';
import { currentRoutineScope } from '../runtime/venture/agents/routine-scope.ts';
import { chatConsent, chiefBusiness, type ChiefEnv } from './venture-chief-helpers.ts';
import { said, scriptChat } from './venture-agent-helpers.ts';
import { NOW, owner } from './venture-judge-helpers.ts';

export const MIN = 60_000;
export const at = (ms: number) => new Date(Date.parse(NOW) + ms).toISOString();
export const ROUTINE: RoutineInput = { name: 'Editor check', agent: 'story-editor', prompt: 'Tell me which videos are waiting on me and what each one needs from me.', on: true, schedule: { kind: 'interval', everyMinutes: 60, from: NOW } };
export type CodexEnv = ChiefEnv & { aiCalls: () => number; presetsAsked: string[] };

const connection = (presetId: 'codex-cli' | 'claude-code-cli', model: string, tiers: ('fast' | 'main')[], when: string) => ({
  id: `conn-${presetId}`, kind: 'venture-model-connection', ventureId: 'x', at: when, revision: 1, presetId, routeKind: presetId === 'codex-cli' ? 'codex-cli' : 'claude-cli', model,
  endpoint: 'this computer', tiers, consentDigest: 'c'.repeat(64), consentedAt: when, monthlyCapMicros: '0', status: 'connected', keyLoaded: true, usable: true, reason: '',
}) as unknown as ModelConnectionView;

export async function codexBusiness(options: { claudeConnectedAt?: string } = {}): Promise<CodexEnv> {
  const env = await chiefBusiness();
  const status = env.models.status.bind(env.models);
  env.models.status = ((...args: Parameters<typeof status>) => {
    const view = status(...args);
    const connections = [connection('codex-cli', view.tiers.main.model ?? 'codex', ['fast', 'main'], NOW)];
    if (options.claudeConnectedAt) connections.push(connection('claude-code-cli', 'claude-code', [], options.claudeConnectedAt));
    return { ...view, tiers: { ...view.tiers, main: { ...view.tiers.main, presetId: 'codex-cli' } }, connections };
  }) as typeof status;
  const presetsAsked: string[] = [];
  const preview = env.models.preview;
  env.models.preview = async (ctx, task) => {
    const backup = currentRoutineScope()?.presetId;
    presetsAsked.push(backup ?? 'codex-cli');
    const made = await preview(ctx, task);
    if (!made || !backup) return made;
    return { ...made, presetId: backup, model: 'claude-code' };
  };
  assert.equal(chatRoute(env.models.status())?.presetId, 'codex-cli');
  await ventureAction(env.deps, owner, 'prepare', 'test.check', tx => tx.put<ConnectorCheckRecord>({
    ...tx.base('venture-connector-check'), rows: [{ connectorId: 'model:codex-cli', outcome: 'answered', line: 'Codex answered.', account: null, expiresOn: null }],
  }));
  await chatConsent(env);
  let calls = 0;
  scriptChat(env, { answer: () => { calls++; return { parts: [said('Two videos wait on your notes.')] }; } });
  await env.agents('venture.routines.set', { routine: ROUTINE });
  return Object.assign(env, { aiCalls: () => calls, presetsAsked });
}
