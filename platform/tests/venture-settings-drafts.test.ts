// Ink v2 wave 4 (4J2, W3's O22): autosave for settings forms. venture.settings.draft keeps a form's unsent edits in the
// vault (never browser storage) and answers "Saved"; venture.settings.drafts lists them with their times, for "Recover
// unsaved changes from 18:42?"; a draft is cleared only when the form's real setting method succeeds with the same values.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import type { SettingsDraftSaved, SettingsDraftsView } from '../runtime/venture/contracts.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { handlers as core } from '../runtime/venture/core/index.ts';
import { SETTINGS_SAVE_METHODS, VentureHost } from '../runtime/venture/host.ts';
import { SETTINGS_FORMS } from '../runtime/venture/core/settings-drafts.ts';
import { code, owner, setup, type Env } from './venture-views-env.ts';

const viewer: Context = { memberId: 'viewer', role: 'viewer', epoch: 1, channel: 'desktop' };
const cofounder: Context = { memberId: 'cofounder', role: 'owner', epoch: 1, channel: 'desktop' };
const handler = <T>(method: string) => (env: Env, payload: unknown, ctx: Context = owner) =>
  (core as Record<string, (deps: Env['deps'], ctx: Context, payload: unknown) => Promise<T>>)[method](env.deps, ctx, payload);
const draft = handler<SettingsDraftSaved>('venture.settings.draft');
const drafts = (env: Env, ctx: Context = owner) => handler<SettingsDraftsView>('venture.settings.drafts')(env, {}, ctx);

function hostOf(env: Env): VentureHost {
  return new VentureHost(env.store, env.deps.services, {
    demo: true, storage: 'experimental-file', host: 'test', clock: env.deps.clock, workspace: env.workspace,
    modelTransport: { replay: true, http: async () => { throw new ChausarError('FIXTURE_MISSING', 'No recording in this test.'); }, process: async () => { throw new ChausarError('FIXTURE_MISSING', 'No recording in this test.'); } },
  });
}

test('draft keeps a form\'s unsent edits in the vault and answers Saved; drafts lists them, newest first, with times', async () => {
  const env = await setup();
  const saved = await draft(env, { form: 'owner', values: { firstName: 'Ash' } });
  assert.deepEqual(saved, { form: 'owner', at: env.now(), line: 'Saved' });
  env.advance(42 * 60_000);
  await draft(env, { form: 'owner', values: { firstName: 'Asha' } });
  env.advance(60_000);
  await draft(env, { form: 'goals', values: { month: '2026-10', amountMinor: '5000000' } });
  const { drafts: listed } = await drafts(env);
  assert.deepEqual(listed.map(item => [item.form, item.values]), [['goals', { month: '2026-10', amountMinor: '5000000' }], ['owner', { firstName: 'Asha' }]]);
  assert.equal(listed[1].at, '2026-10-15T10:42:00.000Z', 'the time of the last keep, for "Recover unsaved changes from ..."');
  assert.equal(listRecords(env.store.read(), 'venture-settings-draft').length, 2, 'one draft per form, replaced as the owner types');
  // Each member's drafts are their own; a viewer can't keep one.
  await env.store.update(state => {
    state.members.push({ id: 'viewer', name: 'Viewer', role: 'viewer', active: true, epoch: 1, branches: ['*'] });
    state.members.push({ id: 'cofounder', name: 'Cofounder', role: 'owner', active: true, epoch: 1, branches: ['*'] });
  });
  assert.deepEqual((await drafts(env, cofounder)).drafts, []);
  await assert.rejects(draft(env, { form: 'owner', values: { firstName: 'X' } }, viewer), code('FORBIDDEN'));
});

test('draft takes known forms and plain fields only', async () => {
  const env = await setup();
  await assert.rejects(draft(env, { form: 'browser', values: {} }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(draft(env, { form: 'owner', values: ['Asha'] }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(draft(env, { form: 'owner', values: null }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(draft(env, { form: 'owner', values: { firstName: 'x'.repeat(17_000) } }), code('INVALID_VENTURE_REQUEST'));
  // Only the fields the form's real method takes.
  await assert.rejects(draft(env, { form: 'owner', values: { note: 'Asha' } }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(draft(env, { form: 'goals', values: { month: '2026-10', firstName: 'Asha' } }), code('INVALID_VENTURE_REQUEST'));
  for (const [form, values] of [
    ['spend-policy', { capUsd: '20', askFirstUsd: '1', dailyCapUsd: null, alertPermille: 800, agentCaps: [], writeCaps: {} }],
    // 4Z3: which currency leads spend is a field of the Limits and rates form too.
    ['spend-policy', { capUsd: '20', askFirstUsd: null, inrPerUsd: '83.50', currencyLead: 'usd', rates: [] }],
    ['notifications', { quietHours: { from: '22:00', to: '07:00' }, push: false }],
    ['goals', { month: '2026-10', amountMinor: '5000000' }],
    ['posting-limits', { connectorId: 'linkedin', limits: {} }],
    ['pipeline', { weekdays: [1, 2, 3], sendTime: '10:00' }],
  ] as const) assert.equal((await draft(env, { form, values })).line, 'Saved', form);
  await assert.rejects(draft(env, { form: 'owner' }), code('INVALID_VENTURE_REQUEST'));
  assert.deepEqual([...SETTINGS_SAVE_METHODS].sort(), Object.values(SETTINGS_FORMS).sort(), 'the host clears the forms settings-drafts names');
});

test('a draft is cleared only when the real setting method succeeds with the same values', async () => {
  const env = await setup();
  const host = hostOf(env);
  try {
    // A save that fails clears nothing, even with the draft's own values.
    await draft(env, { form: 'owner', values: { firstName: 'Asha!' } });
    await assert.rejects(host.request(owner, 'venture.owner.set', { firstName: 'Asha!' }), code('OWNER_NAME_INVALID'));
    assert.equal((await drafts(env)).drafts.length, 1);
    // Saved with other values: the draft stays.
    await draft(env, { form: 'owner', values: { firstName: 'Asha' } });
    await host.request(owner, 'venture.owner.set', { firstName: 'Ashok' });
    assert.equal((await drafts(env)).drafts.length, 1);
    // Saved with exactly the draft's values: cleared.
    await host.request(owner, 'venture.owner.set', { firstName: 'Asha' });
    assert.deepEqual((await drafts(env)).drafts, []);
    // A cleared draft keeps none of its values.
    const [cleared] = listRecords(env.store.read(), 'venture-settings-draft');
    assert.deepEqual([cleared.values, typeof cleared.clearedAt], [{}, 'string']);
    // A new edit after that is a new draft again.
    await draft(env, { form: 'owner', values: { firstName: 'Asha K' } });
    assert.equal((await drafts(env)).drafts.length, 1);
  } finally {
    host.close();
  }
});

test('a draft never keeps a key, a card or an account number, anywhere in its fields', async () => {
  const env = await setup();
  const key = 'sk-ant-' + 'api03-' + 'C'.repeat(40);
  await assert.rejects(draft(env, { form: 'owner', values: { firstName: key } }), code('DRAFT_HOLDS_SECRET'));
  await assert.rejects(draft(env, { form: 'spend-policy', values: { agentCaps: [{ agent: `marketing ${key}`, capUsd: '5' }] } }), code('DRAFT_HOLDS_SECRET'));
  await assert.rejects(draft(env, { form: 'owner', values: { excludedServices: ['4111 1111 1111 1111'] } }), code('DRAFT_HOLDS_SECRET'));
  assert.equal(listRecords(env.store.read(), 'venture-settings-draft').length, 0, 'nothing kept');
});

test('a draft older than 30 days is not offered, and its values are blanked when the member next saves', async () => {
  const env = await setup();
  await draft(env, { form: 'owner', values: { firstName: 'Asha' } });
  env.advance(31 * 24 * 60 * 60_000);
  assert.deepEqual((await drafts(env)).drafts, []);
  await draft(env, { form: 'goals', values: { month: '2026-11', amountMinor: '100000' } });
  const old = listRecords(env.store.read(), 'venture-settings-draft').find(record => record.form === 'owner')!;
  assert.deepEqual(old.values, {});
  assert.deepEqual((await drafts(env)).drafts.map(item => item.form), ['goals']);
});
