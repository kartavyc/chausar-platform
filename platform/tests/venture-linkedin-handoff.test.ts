// Chausar founder boundary: LinkedIn is copy-and-open only, including saved browser/API capability.
import test from 'node:test';
import assert from 'node:assert/strict';
import { postingOptions, postHandoff, proposePost } from '../runtime/venture/build/posting.ts';
import { VentureTestStore } from './venture-test-store.ts';
import type { VentureDeps } from '../runtime/venture/contracts.ts';

test('LinkedIn stays handoff-only even when API and local browser are installed', () => {
 const options = postingOptions('linkedin', { browser: { present: true, reason: 'Installed' }, appReviewed: ['linkedin'], apiClients: ['linkedin'] });
 assert.ok(options.filter(option => option.mode !== 'handoff').every(option => option.status !== 'available'));
 assert.ok(options.filter(option => option.mode !== 'handoff').every(option => /copy|paste|hand/i.test(option.reason ?? '')));
 assert.equal(postHandoff('linkedin', 'The exact owner-approved post.').copy, 'The exact owner-approved post.');
});

test('a LinkedIn proposal is refused before browser probing or recording an outside action', async () => {
 let probes = 0;
 const store = new VentureTestStore();
 const deps = { store, clock: () => new Date('2026-10-27T12:00:00Z'), connectors: { browser: { probe: async () => { probes++; return { present: true, reason: 'Installed' }; } } } } as unknown as VentureDeps;
 for (const mode of ['api', 'owner-browser-session']) {
  await assert.rejects(proposePost(deps, { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' }, { connectorId: 'linkedin', draftId: 'run-example', mode }), { code: 'NOT_BUILT_YET' });
 }
 assert.equal(probes, 0);
});
