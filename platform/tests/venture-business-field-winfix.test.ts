// Seen in the real app on Windows (15 Nov 2026): under the potter's name the sidebar said "Service business", though
// her field is Creative work. That line was the label of the service type a keyword guess gave the idea ('other' when
// nothing matched), shown as if it were a fact. venture.get now carries the field the owner kept (venture.owner.set
// { familyId }), by its own label, so a screen can say something true or nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FAMILIES } from '../runtime/venture/core/families.ts';
import { chiefBusiness } from './venture-chief-helpers.ts';

test('venture.get names the field the owner kept, by its label, and names none until one is kept', async () => {
  const env = await chiefBusiness();
  const before = await env.call('venture.get', {});
  assert.equal('field' in before, false);
  await env.call('venture.owner.set', { familyId: 'creative' });
  assert.deepEqual((await env.call('venture.get', {})).field, { id: 'creative', label: 'Creative work' });
  // Every field has a label to show.
  for (const family of FAMILIES) {
    await env.call('venture.owner.set', { familyId: family.id });
    assert.deepEqual((await env.call('venture.get', {})).field, { id: family.id, label: family.label });
  }
  // Taken back, nothing is named again.
  await env.call('venture.owner.set', { familyId: null });
  assert.equal('field' in await env.call('venture.get', {}), false);
});
