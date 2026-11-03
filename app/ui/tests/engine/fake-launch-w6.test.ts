// W6 6C4: the fake engine answers venture.launch.status and venture.launch.advance exactly as delivery/launch.ts does.
import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import { LAUNCH_WORDS } from '../../src/engine/fake-launch';
import type { DeliveryLite, LaunchStatusView, OrderLite } from '../../src/engine/types';
import { MODEL_PRESETS } from '../../src/engine/fixtures-business';
// The engine's words (delivery/launch.ts and policy/auto-lock.ts), pinned word for word on both sides (venture-delivery.test.ts).
const REASON_CONNECT_AI = 'Connect your AI first.';
const REASON_ACCEPT_PLAN = 'Accept your plan first.';
const PRACTICE_LINE = 'Real orders get practice drafts that never reach clients.';
const LIVE_LINE = 'You approve each draft before it reaches a client.';
const AUTO_LOCKED_WORDS = 'Routine-step approval is not available yet.';

async function connect(engine: FakeEngine) {
  const preset = MODEL_PRESETS.find((item) => item.id === 'codex-cli')!, before = structuredClone(preset);
  try { engine.firstRun.signIn(); await engine.request('venture.models.connect', { presetId: preset.id, consentDigest: preset.consentDigest }); } finally { Object.assign(preset, before); }
}

describe('fake launch stages (6C4)', () => {
  it('uses the engine words, word for word', () => {
    expect([LAUNCH_WORDS.connectAi, LAUNCH_WORDS.acceptPlan, LAUNCH_WORDS.practice, LAUNCH_WORDS.live, LAUNCH_WORDS.autoLocked])
      .toEqual([REASON_CONNECT_AI, REASON_ACCEPT_PLAN, PRACTICE_LINE, LIVE_LINE, AUTO_LOCKED_WORDS]);
  });

  it('shows Practice and Live only, opens Live with a connected AI, and moves down any time', async () => {
    const engine = new FakeEngine();
    let status = await engine.request('venture.launch.status', {}) as LaunchStatusView;
    expect(status.stage).toBe('practice');
    expect(status.stages.map((item) => [item.stage, item.current])).toEqual([['practice', true], ['live', false]]);
    expect(JSON.stringify(status.stages)).not.toMatch(/shadow|rehears|approve-sample|auto-spot-check/);
    if (!status.stages[1]!.allowed) {
      expect(status.stages[1]!.reason).toBe(REASON_CONNECT_AI);
      await expect(engine.request('venture.launch.advance', { to: 'live' })).rejects.toMatchObject({ code: 'LAUNCH_STAGE_BLOCKED', message: REASON_CONNECT_AI });
      await connect(engine);
    }
    for (const to of ['shadow', 'approve-each', 'rehearsal', 'approve-sample']) await expect(engine.request('venture.launch.advance', { to } as never)).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    await expect(engine.request('venture.launch.advance', { to: 'auto-spot-check' } as never)).rejects.toMatchObject({ code: 'AUTO_LOCKED', message: AUTO_LOCKED_WORDS });
    status = await engine.request('venture.launch.advance', { to: 'live' }) as LaunchStatusView;
    expect(status.stage).toBe('live');
    expect(status.stages[1]).toMatchObject({ allowed: true, reason: LIVE_LINE, current: true });
    expect(((await engine.request('venture.get', {})) as { venture: { launchStage: string } }).venture.launchStage).toBe('approve-each');
    status = await engine.request('venture.launch.advance', { to: 'practice' }) as LaunchStatusView;
    expect(status.stage).toBe('practice');
    expect(((await engine.request('venture.get', {})) as { venture: { launchStage: string } }).venture.launchStage).toBe('rehearsal');
  });

  it('marks an AI job for a real order as practice in Practice and as live work in Live', async () => {
    const engine = new FakeEngine();
    await connect(engine);
    const order = (await engine.request('venture.order.list') as OrderLite[])[0]!;
    const consent = await engine.request('venture.client.aiConsent.get', { clientId: order.clientId }) as { disclosureDigest: string };
    await engine.request('venture.client.aiConsent.agree', { clientId: order.clientId, disclosureDigest: consent.disclosureDigest });
    const practice = await engine.request('venture.delivery.run', { orderId: order.id }) as DeliveryLite;
    expect(practice.servedBy).toBe('model');
    expect(practice.practice).toBe(true);
    await engine.request('venture.launch.advance', { to: 'live' });
    const live = await engine.request('venture.delivery.run', { orderId: order.id }) as DeliveryLite;
    expect(live.practice).toBe(false);
  });
});
