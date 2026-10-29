// Founder rule parity: LinkedIn proposals never queue an automatic post.
import { expect, it } from 'vitest';
import { FakePostingDesk } from '../../src/engine/fake-posting';
import { FakeEngine } from '../../src/engine/fake';
import type { ConnectorCardLite } from '../../src/engine/types';
it('LinkedIn is unavailable for automatic posting in the fake connector list', async () => {
 const engine = new FakeEngine();
 const cards = await engine.request('venture.connectors.list', {}) as ConnectorCardLite[];
 const linkedin = cards.find(card => card.id === 'linkedin')!;
 expect(linkedin.postingOptions.filter(option => option.mode !== 'handoff').every(option => option.status !== 'available')).toBe(true);
});
it('a valid fake LinkedIn draft cannot queue a post', () => {
 let queued = false;
 const desk = new FakePostingDesk({ current: () => 'business', now: () => '2026-10-27T12:00:00Z', emit: () => {}, hosted: () => false, rows: () => [], setRows: () => { queued = true; }, digest: () => 'digest', ask: () => ({ links: [{ answer: { decision: 'approved' } }], posts: [{ draftId: 'd-social.post-1', connectorId: 'linkedin', name: 'LinkedIn', channel: 'linkedin', text: 'A source-backed post.' }] }) });
 expect(() => desk.request('venture.posting.propose', { draftId: 'd-social.post-1' })).toThrowError(expect.objectContaining({ code: 'NOT_BUILT_YET' }));
 expect(queued).toBe(false);
});
