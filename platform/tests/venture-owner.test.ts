// Ink v2 wave 4, package 4J9: the owner profile. venture.owner.get answers the owner's first name (for Today's
// greeting only), the services the business does not sell (C21, read by 4E2's outreach check) and the business name.
// venture.owner.set keeps them inside the app at the approve level: a first name of letters in any script, spaces, dots,
// hyphens and apostrophes between letters, nothing more about the owner (minimum data), and a name the owner can take
// back, told that earlier backups still hold it.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { ModelTransport, OwnerView, VentureDeps } from '../runtime/venture/contracts.ts';
import { handlers } from '../runtime/venture/core/index.ts';
import { excludedServicesOf, ownerProfileOf } from '../runtime/venture/core/owner.ts';
import { VentureHost } from '../runtime/venture/host.ts';
import { BACKUPS_LINE } from '../runtime/venture/network/forget.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { code, owner, phone, setup, type Env } from './venture-views-env.ts';

/** The zero-width joiner and non-joiner, made here so no invisible character sits in this file. */
const ZWJ = String.fromCharCode(0x200d), ZWNJ = String.fromCharCode(0x200c);

type Handler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;
const core = handlers as Record<string, Handler>;
const get = (env: Env, ctx: Context = owner) => core['venture.owner.get'](env.deps, ctx, {}) as Promise<OwnerView>;
const set = (env: Env, payload: unknown, ctx: Context = owner) => core['venture.owner.set'](env.deps, ctx, payload) as Promise<OwnerView>;

test('before anything is set, the profile is empty and carries the business name', async () => {
  const env = await setup();
  assert.deepEqual(await get(env), { firstName: null, excludedServices: [], businessName: 'Ledger Cafe Books' });
  // A read: the phone may ask for it too.
  assert.deepEqual(await get(env, phone), { firstName: null, excludedServices: [], businessName: 'Ledger Cafe Books' });
  assert.equal(listRecords(env.store.read(), 'venture-owner-profile').length, 0, 'a read writes nothing');
});

test('a first name of letters in any script, spaces, dots and hyphens is kept, trimmed', async () => {
  const env = await setup();
  for (const [typed, kept] of [
    ['Kartavy', 'Kartavy'], ['  Asha  ', 'Asha'], ['कार्तव्य', 'कार्तव्य'], ['Anne-Marie', 'Anne-Marie'], ['J. R.', 'J. R.'],
    ['José', 'José'], ['Mary  Ann', 'Mary Ann'], ['محمد', 'محمد'], ['A'.repeat(40), 'A'.repeat(40)],
    // Apostrophes between letters; the curly one is kept as the straight one.
    ["D'Souza", "D'Souza"], ['O\u2019Brien', "O'Brien"], ["Mary-Kate O'Neil", "Mary-Kate O'Neil"],
    // Joiners after a letter or a mark: a Malayalam chillu (virama then ZWJ, at the end), a Persian ZWNJ, a Hindi half form.
    [`ശ്രീലാല്${ZWJ}`, `ശ്രീലാല്${ZWJ}`], [`علی${ZWNJ}رضا`, `علی${ZWNJ}رضا`], [`क्${ZWJ}षमा`, `क्${ZWJ}षमा`],
  ]) {
    const view = await set(env, { firstName: typed });
    assert.equal(view.firstName, kept, typed);
    assert.equal((await get(env)).firstName, kept, typed);
  }
  assert.equal((await get(env)).businessName, 'Ledger Cafe Books');
});

test('anything else as a first name is refused with OWNER_NAME_INVALID, and nothing changes', async () => {
  const env = await setup();
  await set(env, { firstName: 'Asha' });
  for (const typed of ['', '   ', 'A'.repeat(41), 'Asha1', 'asha@example.com', 'Asha\nRao', 'Asha\tRao', '...', '-', '. Asha', 'Asha_R',
    'Asha \u{1F600}', '+91 98765 43210', 42, null, ['Asha'],
    // Apostrophes leading, trailing, doubled or beside anything but letters.
    "'Asha", "Asha'", 'Asha\u2019', "D''Souza", "D'\u2019Souza", "D' Souza", "D '", "D.'Souza", "D'-Souza", "'",
    // Joiners anywhere but after a letter or a mark.
    `${ZWJ}Asha`, `Asha ${ZWJ}Rao`, `Asha${ZWJ}${ZWJ}`, `A.${ZWNJ}`, `Asha-${ZWNJ}Rao`, `Asha${ZWNJ}${ZWJ}`]) {
    if (typed === null) continue; // null takes the name back (next test)
    await assert.rejects(set(env, { firstName: typed }), code('OWNER_NAME_INVALID'), JSON.stringify(typed));
  }
  assert.equal((await get(env)).firstName, 'Asha');
});

test('the owner can take the name back: firstName null keeps no name', async () => {
  const env = await setup();
  await set(env, { firstName: 'Asha', excludedServices: ['GST filing'] });
  const view = await set(env, { firstName: null });
  assert.equal(view.firstName, null);
  assert.deepEqual(view.excludedServices, ['GST filing'], 'the services stay');
  assert.deepEqual(view.kept, [BACKUPS_LINE], "the screen can say earlier backups still hold it, in Forget's words");
  const [record] = listRecords(env.store.read(), 'venture-owner-profile');
  assert.equal(record.firstName, null);
  assert.equal(JSON.stringify(env.store.read()).includes('Asha'), false, 'the name is gone from the vault, the activity log included');
  // Only a removal says so: nothing to remove, a new name, a services change or a read carry no kept line.
  assert.equal(Object.hasOwn(await set(env, { firstName: null }), 'kept'), false);
  assert.equal(Object.hasOwn(await set(env, { firstName: 'Meera' }), 'kept'), false);
  assert.equal(Object.hasOwn(await set(env, { excludedServices: [] }), 'kept'), false);
  assert.equal(Object.hasOwn(await get(env), 'kept'), false);
});

test('excluded services: at most 20 lines of at most 80 characters, trimmed, repeats dropped', async () => {
  const env = await setup();
  const view = await set(env, { excludedServices: ['  GST filing ', 'Payroll', 'gst filing', 'Company audits'] });
  assert.deepEqual(view.excludedServices, ['GST filing', 'Payroll', 'Company audits']);
  assert.deepEqual((await get(env)).excludedServices, ['GST filing', 'Payroll', 'Company audits']);
  const twenty = Array.from({ length: 20 }, (_, i) => `Service ${String.fromCharCode(65 + i)}`);
  assert.equal((await set(env, { excludedServices: twenty })).excludedServices.length, 20);
  assert.equal((await set(env, { excludedServices: ['S'.repeat(80)] })).excludedServices[0].length, 80);
  for (const bad of [
    [...twenty, 'Service U'], ['S'.repeat(81)], ['GST\nfiling'], [''], ['   '], [42], 'GST filing', null, {}, ['Tax\u0007'],
  ]) {
    await assert.rejects(set(env, { excludedServices: bad }), code('INVALID_VENTURE_REQUEST'), JSON.stringify(bad));
  }
  assert.deepEqual((await get(env)).excludedServices, ['S'.repeat(80)], 'a refusal changes nothing');
  assert.deepEqual((await set(env, { excludedServices: [] })).excludedServices, [], 'an empty list says nothing is excluded');
});

test('each field changes on its own; the profile is one record, replaced', async () => {
  const env = await setup();
  await set(env, { firstName: 'Asha' });
  await set(env, { excludedServices: ['Payroll'] });
  assert.deepEqual(await get(env), { firstName: 'Asha', excludedServices: ['Payroll'], businessName: 'Ledger Cafe Books' });
  await set(env, { firstName: 'Meera' });
  assert.deepEqual(await get(env), { firstName: 'Meera', excludedServices: ['Payroll'], businessName: 'Ledger Cafe Books' });
  const records = listRecords(env.store.read(), 'venture-owner-profile');
  assert.equal(records.length, 1);
  assert.equal(records[0].ventureId, env.venture.id);
  assert.deepEqual(ownerProfileOf(env.store.read(), env.venture.id), { firstName: 'Meera', excludedServices: ['Payroll'] });
  assert.deepEqual(excludedServicesOf(env.store.read(), env.venture.id), ['Payroll'], '4E2 reads the list from here');
  assert.deepEqual(excludedServicesOf(env.store.read(), 'venture_other'), [], 'another business has none');
});

test('minimum data: nothing but a first name and the excluded services, and at least one of them', async () => {
  const env = await setup();
  for (const payload of [{}, { firstName: 'Asha', surname: 'Rao' }, { email: 'asha@example.com' }, { phone: '+919876543210' }, { businessName: 'Other' }, 'Asha', null, []]) {
    await assert.rejects(set(env, payload), code('INVALID_VENTURE_REQUEST'), JSON.stringify(payload));
  }
  assert.equal(listRecords(env.store.read(), 'venture-owner-profile').length, 0);
});

test('setting the profile is an owner approval inside the app: never the phone, MCP, a tainted request or a viewer', async () => {
  const env = await setup();
  await assert.rejects(set(env, { firstName: 'Asha' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(set(env, { firstName: 'Asha' }, { ...owner, channel: 'mcp' }), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(set(env, { firstName: 'Asha' }, { ...owner, sourceTainted: true }), code('APP_APPROVAL_REQUIRED'));
  await env.store.update(state => { state.members.push({ id: 'viewer', name: 'Viewer', role: 'viewer', active: true, epoch: 1, branches: ['*'] }); });
  await assert.rejects(set(env, { firstName: 'Asha' }, { memberId: 'viewer', role: 'viewer', epoch: 1, channel: 'desktop' }), code('FORBIDDEN'));
  assert.equal(listRecords(env.store.read(), 'venture-owner-profile').length, 0);
  // The hosted web app is inside the app too.
  assert.equal((await set(env, { firstName: 'Asha' }, { ...owner, channel: 'web' })).firstName, 'Asha');
});

test('the business name follows the business record', async () => {
  const env = await setup();
  await set(env, { firstName: 'Asha' });
  const { ventureAction } = await import('../runtime/venture/records.ts');
  await ventureAction(env.deps, owner, 'admin', 'seed.rename', tx => { tx.touch({ workingName: 'Lumen Studio' }); });
  assert.equal((await get(env)).businessName, 'Lumen Studio');
});

test('through the venture host: the desktop sets, the phone is refused before the handler, and a read answers anywhere', async () => {
  const env = await setup();
  const noTransport: ModelTransport = {
    replay: false,
    http: async () => { throw new Error('No network in tests.'); },
    process: async () => { throw new Error('No processes in tests.'); },
  };
  // The real package loaders: core is the package that answers both methods.
  const host = new VentureHost(env.store, env.deps.services, { demo: true, storage: 'experimental-file', host: 'test', clock: env.deps.clock, modelTransport: noTransport });
  const set = await host.request(owner, 'venture.owner.set', { firstName: 'Asha', excludedServices: ['Payroll'] }) as OwnerView;
  assert.deepEqual(set, { firstName: 'Asha', excludedServices: ['Payroll'], businessName: 'Ledger Cafe Books' });
  await assert.rejects(host.request(phone, 'venture.owner.set', { firstName: 'Meera' }), code('APP_APPROVAL_REQUIRED'));
  assert.deepEqual(await host.request(phone, 'venture.owner.get', {}), { firstName: 'Asha', excludedServices: ['Payroll'], businessName: 'Ledger Cafe Books' });
  assert.deepEqual(await host.request(owner, 'venture.owner.get', undefined), { firstName: 'Asha', excludedServices: ['Payroll'], businessName: 'Ledger Cafe Books' });
  await host.close();
});
