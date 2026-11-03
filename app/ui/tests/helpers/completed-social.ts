import type { FakeEngine } from '../../src/engine/fake';
import type { DeliveryLite, OrderLite } from '../../src/engine/types';

/** Test-only completion fixture. No fake API claims to run an installed model. */
export function completedSocialFixture(engine: FakeEngine, order: OrderLite, options: { channel?: string; status?: 'ready-for-review' | 'accepted'; text?: string } = {}): DeliveryLite {
  const work = (engine as any).work;
  const biz = work.host.current();
  const status = options.status ?? 'accepted';
  const channel = options.channel ?? 'LinkedIn';
  const text = options.text ?? `# Fixture draft\n\n## Drafts\n${channel}: Useful Lesson: Share a practical lesson.\n\n## Post plan\nPost 1 | Value | Goal: Teach a useful idea | Reader action: Try it | Hook: Problem and solution`;
  const run: DeliveryLite = { id: 'fixture-completed-' + order.id, at: work.host.now(), orderId: order.id, status, practice: false, servedBy: 'model',
    deliverable: { title: 'Fixture draft' },
    renderedText: text, verdict: status === 'accepted' ? { choice: 'accepted', at: work.host.now() } : null, awaitingYou: status !== 'accepted' };
  (work.deliveries[biz] ??= []).unshift(run);
  return structuredClone(run);
}
export function setFixtureDeliveryStatus(engine: FakeEngine, id: string, status: 'ready-for-review' | 'accepted'): void {
  const work = (engine as any).work;
  const run = work.deliveries[work.host.current()].find((item: DeliveryLite) => item.id === id);
  if (!run) throw new Error('Missing test delivery');
  run.status = status; run.awaitingYou = status !== 'accepted';
  run.verdict = status === 'accepted' ? { choice: 'accepted', at: work.host.now() } : null;
}
import { ghostwritingSections } from '../../../../platform/runtime/venture/playbooks/social/structures-data';
import { planCalendar } from '../../../../platform/runtime/venture/playbooks/social/calendar-core';
import { HOOK_FORMULAS } from '../../../../platform/runtime/venture/playbooks/social/post-plan';
/** Explicit completed model output used only to exercise downstream review validators. */
export function socialReviewFixture(engine: FakeEngine, order: OrderLite, hookOffset = 0): DeliveryLite {
  const work = (engine as any).work, chain = work.socialChain;
  chain.preflight(order);
  const pin = chain.pin(order);
  pin.stage = pin.stages.length;
  const ghost = pin.offerKey === 'linkedin-ghostwriting';
  const headings = ghost ? ghostwritingSections(order.intake as any) : [];
  const intake = order.intake as any;
  const channels: string[] = ghost ? headings.map(() => 'linkedin') : intake?.calendar ? planCalendar(intake.calendar).map(slot => slot.channel) : intake?.fields?.channels ?? ['linkedin'];
  const label = (channel: string) => channel === 'linkedin' ? 'LinkedIn' : channel === 'x' ? 'X' : channel.charAt(0).toUpperCase() + channel.slice(1);
  const posts = channels.map((channel, i) => (ghost ? '## ' + headings[i] + '\n' : '') + label(channel) + ': Share a useful practical lesson.');
  const plans = channels.map((_, i) => `Post ${i + 1} | Value | Goal: Teach a useful idea | Reader action: Try it | Hook: ${HOOK_FORMULAS[(i + hookOffset) % HOOK_FORMULAS.length]}`);
  const text = '# Fixture drafts\n\n' + (ghost ? '' : '## Drafts\n') + posts.join('\n\n') + '\n\n## Post plan\n' + plans.join('\n') + (pin.offerKey === 'repurpose-pack' ? '\n\n## Newsletter blurb\nA useful practical lesson.' : '');
  const run = completedSocialFixture(engine, order, { status: 'ready-for-review', text });
  const stored = work.deliveries[work.host.current()].find((item: DeliveryLite) => item.id === run.id);
  stored.chainStage = pin.stage;
  return structuredClone(stored);
}
