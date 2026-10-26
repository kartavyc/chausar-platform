// Ink v2 wave 4, package 4J8: the setup checklist's items by name, each with the link to the place it is done, so
// Business can list "Setup, 3 of 12" item by item. Links use the app's own address grammar (app/ui/src/shell/routes.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChecklistItemId, VentureView } from '../runtime/venture/contracts.ts';
import { CHECKLIST_TOTAL } from '../runtime/venture/core/checklist.ts';
import { PASSPHRASE, engineFor } from './fixtures/venture/compose-unit/harness.ts';

/** #/<place>[/<sub>], with the places and the segment rule of the app's router. */
const ROUTE = /^#\/(?:today|team|work|clients|money|connections|business|onboarding)(?:\/[a-z0-9][a-z0-9-]{0,47})*$/;

test('checklist: every item has its name and a link to where it is done', async t => {
  const { engine } = await engineFor(t);
  await engine.request('workspace.create', { name: 'Ledger Cafe Books', passphrase: PASSPHRASE, pack: 'services' });
  const view = await engine.request('venture.create', { idea: 'Monthly bookkeeping for cafes and small shops in Pune.', countryCode: 'IN', workingName: 'Ledger Cafe Books' }) as VentureView;
  assert.equal(view.checklist.length, CHECKLIST_TOTAL);
  for (const item of view.checklist) {
    assert.ok(item.label.length > 0, item.id);
    assert.match(item.link, ROUTE, `${item.id}: ${item.link}`);
  }
  assert.equal(new Set(view.checklist.map(item => item.label)).size, view.checklist.length, 'each item has its own name');
  const of = (id: ChecklistItemId) => {
    const item = view.checklist.find(entry => entry.id === id);
    assert.ok(item, id);
    return { label: item.label, link: item.link };
  };
  // Named as Today's setup row names it, and linked to the page that does it.
  assert.deepEqual(of('prices'), { label: 'Set your prices', link: '#/business/prices' });
  assert.deepEqual(of('ai'), { label: 'Connect your AI', link: '#/connections/ai' });
  assert.deepEqual(of('plan'), { label: 'Accept your plan', link: '#/business/plan' });
  assert.deepEqual(of('rehearsal'), { label: 'Rehearse with practice clients', link: '#/business/practice' });
  assert.deepEqual(of('first-client'), { label: 'Add your first client', link: '#/clients' });
  assert.deepEqual(of('first-invoice'), { label: 'Send your first invoice', link: '#/money/invoices' });
  // venture.get carries the same items.
  const got = await engine.request('venture.get', {}) as VentureView;
  assert.deepEqual(got.checklist.map(item => [item.id, item.label, item.link]), view.checklist.map(item => [item.id, item.label, item.link]));
  assert.equal(got.total, CHECKLIST_TOTAL);
});
