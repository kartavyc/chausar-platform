// Business snapshots (Ink v2 wave 4, package 4J6, catalogue C10): what the other businesses on this computer may know
// about one that is closed, encrypted with this computer's key, and the never-contact list they share as keyed
// one-way checks. The file-level rules run on a temp folder with an injected memory key store (two instances are two
// computers); the engine's own writes (at most once a minute while open, again on lock, never for a passphrase
// business, gone with the business) run through the real Engine with experimental file storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { memoryDeviceKeyStore, type DeviceKeyStore } from '../runtime/device-custody.ts';
import { SNAPSHOT_EVERY_MS, WorkspaceSnapshots, snapshotDue } from '../runtime/workspace-snapshots.ts';
import { createReplayTransport } from '../runtime/venture/models/index.ts';
import type { BusinessSnapshot, ModelPreset, ModelReplayFixture } from '../runtime/venture/contracts.ts';
import type { AiOptionsView, ComposeDecision, ComposedPlan } from '../runtime/venture/onboarding-contracts.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.stack ?? error?.message); return true; };

async function folder(t: any, prefix = 'chausar-snapshots-') {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

const figure = (amount: string, display: string, receiptId: string, unit: 'minor' | 'micros' = 'minor', currency = 'INR') => ({ amount, unit, currency, display, receiptId });

/** A snapshot as the open business would write it. */
function sample(overrides: Partial<BusinessSnapshot> = {}): BusinessSnapshot {
  return {
    format: 'chausar.snapshot.v1', businessId: 'lumen-studio', vaultId: 'vault_lumen', name: 'Lumen Studio', playbook: 'youtube-channel',
    asOf: '2026-10-24T05:00:00.000Z',
    money: {
      month: '2026-10', currency: 'INR',
      invoiced: figure('4500000', 'INR 45,000.00', 'sum_a'), received: figure('1200000', 'INR 12,000.00', 'sum_b'),
      owed: figure('5310000', 'INR 53,100.00', 'sum_c'), late: 2, spend: figure('1250000', 'USD 1.2500', 'sum_d', 'micros', 'USD'),
    },
    runs: { working: 1, waiting: 2, stopped: 0 }, needsYou: 3,
    ...overrides,
  };
}

test('a snapshot is encrypted with this computer\'s key: on disk no name or figure shows, it reads back the same, and another computer cannot read it', async t => {
  const directory = await folder(t), keys = memoryDeviceKeyStore();
  const store = new WorkspaceSnapshots(directory, () => keys);
  await store.write('lumen-studio', sample());
  const path = join(directory, 'custody', 'snapshots', 'lumen-studio.json');
  const raw = await readFile(path, 'utf8');
  for (const word of ['Lumen', 'youtube', '45,000', '4500000', 'sum_a', 'vault_lumen']) assert.equal(raw.includes(word), false, word);
  assert.equal(JSON.parse(raw).format, 'chausar.snapshot-file.v1');
  assert.deepEqual(await store.read('lumen-studio', 'vault_lumen'), { read: 'saved', snapshot: sample() });
  // The key itself is the OS's: only its protected record is on disk.
  const record = JSON.parse(await readFile(join(directory, 'custody', 'summary-key.json'), 'utf8'));
  assert.deepEqual([record.format, record.vaultId, record.scheme], ['chausar.device-key.v1', 'chausar-summaries', 'memory']);

  const elsewhere = new WorkspaceSnapshots(directory, () => memoryDeviceKeyStore());
  assert.deepEqual(await elsewhere.read('lumen-studio', 'vault_lumen'), { read: 'unreadable', snapshot: null }, 'another computer');
});

test('a tampered, moved or other-vault snapshot reads as unreadable; one never written reads as none; remove takes it away', async t => {
  const directory = await folder(t), keys = memoryDeviceKeyStore();
  const store = new WorkspaceSnapshots(directory, () => keys);
  await store.write('lumen-studio', sample());
  const path = join(directory, 'custody', 'snapshots', 'lumen-studio.json');
  const file = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(await store.read('lumen-studio', 'vault_other'), { read: 'unreadable', snapshot: null }, 'a folder reused by another vault');
  // Moved under another business's name: the folder is bound into the encryption.
  await writeFile(join(directory, 'custody', 'snapshots', 'sitara-events.json'), JSON.stringify(file));
  assert.deepEqual(await store.read('sitara-events', null), { read: 'unreadable', snapshot: null });
  const data = Buffer.from(file.data, 'base64'); data[0] ^= 1;
  await writeFile(path, JSON.stringify({ ...file, data: data.toString('base64') }));
  assert.deepEqual(await store.read('lumen-studio', 'vault_lumen'), { read: 'unreadable', snapshot: null });
  await writeFile(path, 'not json');
  assert.deepEqual(await store.read('lumen-studio', 'vault_lumen'), { read: 'unreadable', snapshot: null });
  assert.deepEqual(await store.read('never-opened', null), { read: 'none', snapshot: null });
  await store.remove('lumen-studio');
  assert.deepEqual(await store.read('lumen-studio', 'vault_lumen'), { read: 'none', snapshot: null });
  await assert.rejects(store.write('../escape', sample({ businessId: '../escape' })), code('INVALID_SNAPSHOT'));
});

test('a snapshot that holds a client\'s words, an unknown field or a wrong figure is refused before it is written', async t => {
  const directory = await folder(t);
  const store = new WorkspaceSnapshots(directory, () => memoryDeviceKeyStore());
  await assert.rejects(store.write('lumen-studio', { ...sample(), clients: ['Cafe Aroma Demo'] } as never), code('INVALID_SNAPSHOT'));
  await assert.rejects(store.write('lumen-studio', sample({ businessId: 'sitara-events' })), code('INVALID_SNAPSHOT'), 'its own folder only');
  await assert.rejects(store.write('lumen-studio', sample({ needsYou: -1 })), code('INVALID_SNAPSHOT'));
  const money = sample().money!;
  await assert.rejects(store.write('lumen-studio', sample({ money: { ...money, owed: { ...money.owed, amount: '12.5' } } })), code('INVALID_SNAPSHOT'));
  await assert.rejects(store.write('lumen-studio', sample({ money: { ...money, invoiced: { ...money.invoiced, note: 'Paid by Asha' } as never } })), code('INVALID_SNAPSHOT'));
  // A display is a formatted amount, never words; a receipt id is an id; each figure is in its business's currency.
  await assert.rejects(store.write('lumen-studio', sample({ money: { ...money, owed: { ...money.owed, display: 'Asha Rao owes INR 5' } } })), code('INVALID_SNAPSHOT'));
  await assert.rejects(store.write('lumen-studio', sample({ money: { ...money, owed: { ...money.owed, receiptId: 'Cafe Aroma Demo' } } })), code('INVALID_SNAPSHOT'));
  await assert.rejects(store.write('lumen-studio', sample({ money: { ...money, owed: { ...money.owed, currency: 'GBP', display: 'GBP 53,100.00' } } })), code('INVALID_SNAPSHOT'));
  await assert.rejects(store.write('lumen-studio', sample({ money: { ...money, spend: { ...money.spend, currency: 'INR', display: 'INR 1.2500' } } })), code('INVALID_SNAPSHOT'));
  assert.deepEqual(await readdir(join(directory, 'custody')).catch(() => []), [], 'nothing written, not even a key');
});

test('the never-contact list holds keyed one-way checks only; any spelling of a listed address matches; a copy without its key fails closed', async t => {
  const directory = await folder(t), keys = memoryDeviceKeyStore();
  const store = new WorkspaceSnapshots(directory, () => keys);
  assert.equal(await store.neverContactHas(['asha@dewdrop.example']), false, 'an empty list holds nobody');
  await store.neverContactAdd(['Asha@Dewdrop.example ', '+919900122334', 'https://www.linkedin.com/in/asha-rao', '']);
  const raw = await readFile(join(directory, 'custody', 'never-contact.json'), 'utf8');
  for (const word of ['asha', 'dewdrop', '9900122334', 'linkedin']) assert.equal(raw.toLowerCase().includes(word), false, word);
  const list = JSON.parse(raw);
  assert.equal(list.format, 'chausar.never-contact.v1');
  assert.equal(list.scheme, 'hmac-sha256');
  assert.equal(list.hashes.length, 3);
  for (const hash of list.hashes) assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(await store.neverContactHas(['asha@dewdrop.example']), true);
  assert.equal(await store.neverContactHas(['someone@else.example', '+919900122334']), true);
  assert.equal(await store.neverContactHas(['someone@else.example']), false);
  await store.neverContactAdd(['asha@dewdrop.example']);
  assert.equal(JSON.parse(await readFile(join(directory, 'custody', 'never-contact.json'), 'utf8')).hashes.length, 3, 'kept once');

  // Its own key and a MAC over the checks: the summary key is not used for it.
  assert.match(list.mac, /^[0-9a-f]{64}$/);
  const record = JSON.parse(await readFile(join(directory, 'custody', 'never-contact-key.json'), 'utf8'));
  assert.equal(record.vaultId, 'chausar-never-contact');
  await assert.rejects(readFile(join(directory, 'custody', 'summary-key.json')), code('ENOENT'), 'no summary key was needed');

  // Copied to another computer without its key: it can't be checked there, and it is never emptied or overwritten.
  const other = await folder(t);
  await mkdir(join(other, 'custody'));
  await writeFile(join(other, 'custody', 'never-contact.json'), raw);
  const elsewhere = new WorkspaceSnapshots(other, () => memoryDeviceKeyStore());
  await assert.rejects(elsewhere.neverContactHas(['asha@dewdrop.example']), code('NEVER_CONTACT_LOST'));
  await assert.rejects(elsewhere.neverContactAdd(['priya@neem.example']), code('NEVER_CONTACT_LOST'));
  assert.equal(await readFile(join(other, 'custody', 'never-contact.json'), 'utf8'), raw, 'kept as it was');
});

/** A list with Asha on it in a fresh folder, its raw file and key record, and a store over a key store a test may bend. */
async function listed(t: any) {
  const directory = await folder(t), keys = memoryDeviceKeyStore();
  await new WorkspaceSnapshots(directory, () => keys).neverContactAdd(['asha@dewdrop.example']);
  const listPath = join(directory, 'custody', 'never-contact.json'), keyPath = join(directory, 'custody', 'never-contact-key.json');
  return { directory, keys, listPath, keyPath, raw: await readFile(listPath, 'utf8'), record: await readFile(keyPath, 'utf8') };
}

/** Both reads refuse with this code, and the list file is left exactly as it was. */
async function failsClosed(store: WorkspaceSnapshots, listPath: string, before: string, expected: string, why: string) {
  await assert.rejects(store.neverContactHas(['asha@dewdrop.example']), code(expected), `has: ${why}`);
  await assert.rejects(store.neverContactAdd(['priya@neem.example']), code(expected), `add: ${why}`);
  assert.equal(await readFile(listPath, 'utf8').catch(() => null), before, `kept: ${why}`);
}

test('the never-contact list fails closed for every way its key or file can go wrong, and never starts again silently', async t => {
  {
    const env = await listed(t);
    await rm(env.keyPath);
    await failsClosed(new WorkspaceSnapshots(env.directory, () => env.keys), env.listPath, env.raw, 'NEVER_CONTACT_LOST', 'no key file, checks on the list');
  }
  {
    const env = await listed(t);
    await writeFile(env.keyPath, 'not a key record');
    await failsClosed(new WorkspaceSnapshots(env.directory, () => env.keys), env.listPath, env.raw, 'NEVER_CONTACT_LOST', 'a corrupt key record');
    await writeFile(env.keyPath, JSON.stringify({ ...JSON.parse(env.record), vaultId: 'chausar-summaries' }));
    await failsClosed(new WorkspaceSnapshots(env.directory, () => env.keys), env.listPath, env.raw, 'NEVER_CONTACT_LOST', 'another key\'s record');
  }
  {
    const env = await listed(t);
    const lostKey: DeviceKeyStore = { ...env.keys, unprotect: async () => null };
    await failsClosed(new WorkspaceSnapshots(env.directory, () => lostKey), env.listPath, env.raw, 'NEVER_CONTACT_LOST', 'the OS lost the key');
    const short: DeviceKeyStore = { ...env.keys, unprotect: async () => Buffer.alloc(16, 1) };
    await failsClosed(new WorkspaceSnapshots(env.directory, () => short), env.listPath, env.raw, 'NEVER_CONTACT_LOST', 'a key of the wrong length');
  }
  {
    // Another list key: the key file is replaced by a record of a new key from the same store.
    const env = await listed(t);
    const record = await env.keys.protect('chausar-never-contact', Buffer.alloc(32, 7));
    await writeFile(env.keyPath, JSON.stringify(record));
    await failsClosed(new WorkspaceSnapshots(env.directory, () => env.keys), env.listPath, env.raw, 'NEVER_CONTACT_LOST', 'a key id that does not match');
  }
  {
    const env = await listed(t);
    const list = JSON.parse(env.raw);
    const tampered = JSON.stringify({ ...list, hashes: [] });
    await writeFile(env.listPath, tampered);
    await failsClosed(new WorkspaceSnapshots(env.directory, () => env.keys), env.listPath, tampered, 'NEVER_CONTACT_LOST', 'a check taken out (the MAC fails)');
    for (const bad of ['not json', JSON.stringify({ ...list, hashes: ['nothex'] }), JSON.stringify({ ...list, note: 'x' }), JSON.stringify([])]) {
      await writeFile(env.listPath, bad);
      await failsClosed(new WorkspaceSnapshots(env.directory, () => env.keys), env.listPath, bad, 'NEVER_CONTACT_LOST', `a bad file: ${bad.slice(0, 30)}`);
    }
    // Something that is not a plain file where the list should be: it may answer later, never "nobody".
    await rm(env.listPath);
    await mkdir(env.listPath);
    await assert.rejects(new WorkspaceSnapshots(env.directory, () => env.keys).neverContactHas(['asha@dewdrop.example']), code('TIER_UNAVAILABLE'));
  }
  {
    // An empty list of another key put in place of the list: still lost for add, not a fresh start.
    const env = await listed(t);
    const foreign = JSON.stringify({ ...JSON.parse(env.raw), hashes: [], keyId: '0123456789abcdef' });
    await writeFile(env.listPath, foreign);
    await failsClosed(new WorkspaceSnapshots(env.directory, () => env.keys), env.listPath, foreign, 'NEVER_CONTACT_LOST', 'an empty list of another key');
  }
  {
    // A key file with no list beside it: the list was taken away, never "nobody".
    const env = await listed(t);
    await rm(env.listPath);
    await assert.rejects(new WorkspaceSnapshots(env.directory, () => env.keys).neverContactHas(['asha@dewdrop.example']), code('NEVER_CONTACT_LOST'));
    await assert.rejects(new WorkspaceSnapshots(env.directory, () => env.keys).neverContactAdd(['priya@neem.example']), code('NEVER_CONTACT_LOST'));
    await assert.rejects(readFile(env.listPath), code('ENOENT'), 'nothing written');
  }
  {
    // The key and its empty list are made in one step: a new key never stands without a list.
    // The first reset on a computer with no list at all leaves both files: an empty list and its key.
    const directory = await folder(t), keys = memoryDeviceKeyStore();
    await new WorkspaceSnapshots(directory, () => keys).neverContactReset();
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'custody', 'never-contact.json'), 'utf8')).hashes, []);
    assert.equal(await new WorkspaceSnapshots(directory, () => keys).neverContactHas(['asha@dewdrop.example']), false);
  }
  {
    // A new summary key never touches the list.
    const env = await listed(t);
    const store = new WorkspaceSnapshots(env.directory, () => env.keys);
    await store.write('lumen-studio', sample());
    await rm(join(env.directory, 'custody', 'summary-key.json'));
    const again = new WorkspaceSnapshots(env.directory, () => env.keys);
    await again.write('lumen-studio', sample());
    assert.equal(await again.neverContactHas(['asha@dewdrop.example']), true);
  }
});

test('starting a new never-contact list is the owner\'s explicit step, and says what it can and cannot bring back', async t => {
  const env = await listed(t);
  await rm(env.keyPath);
  const store = new WorkspaceSnapshots(env.directory, () => env.keys);
  await assert.rejects(store.neverContactHas(['asha@dewdrop.example']), (error: any) => {
    assert.equal(error.message, "Chausar can no longer check the never-contact list on this computer, so it drafts nothing. You can start a new list: each business adds its own blocklist again when you next open it, but people forgotten in other businesses can't be put back.");
    return true;
  });
  assert.equal(await store.neverContactReset(), "Chausar started a new never-contact list on this computer. Each business adds its own blocklist again the next time you open it. People forgotten in other businesses can't be put back on it.");
  assert.equal(await store.neverContactHas(['asha@dewdrop.example']), false);
  await store.neverContactAdd(['asha@dewdrop.example']);
  assert.equal(await new WorkspaceSnapshots(env.directory, () => env.keys).neverContactHas(['asha@dewdrop.example']), true);
});

test('with checks on the list and a key store that does not answer, the list refuses to say nobody is on it (TIER_UNAVAILABLE)', async t => {
  const directory = await folder(t), keys = memoryDeviceKeyStore();
  await new WorkspaceSnapshots(directory, () => keys).neverContactAdd(['asha@dewdrop.example']);
  const silent: DeviceKeyStore = { ...keys, probe: async () => ({ available: false, reason: 'failed' }), unprotect: async () => { throw new Error('the OS did not answer'); } };
  const store = new WorkspaceSnapshots(directory, () => silent);
  await assert.rejects(store.neverContactHas(['asha@dewdrop.example']), (error: any) => {
    assert.equal(error.code, 'TIER_UNAVAILABLE');
    assert.equal(error.message, "Chausar can't check your never-contact list on this computer right now, so it drafts nothing. Try again in a moment.");
    return true;
  });
  // The key store answers its probe but refuses this key (Windows DPAPI with the key gone bad): lost, not "try again".
  const refusing: DeviceKeyStore = { ...keys, unprotect: async () => { throw new Error('DPAPI refused'); } };
  await assert.rejects(new WorkspaceSnapshots(directory, () => refusing).neverContactHas(['asha@dewdrop.example']), code('NEVER_CONTACT_LOST'));
  // With no key store at all (no protected storage here), nothing can be listed or read.
  const none = new WorkspaceSnapshots(directory, () => null);
  await assert.rejects(none.neverContactHas(['asha@dewdrop.example']), code('TIER_UNAVAILABLE'));
  assert.deepEqual(await none.read('lumen-studio', null), { read: 'none', snapshot: null });
});

test('snapshotDue: never twice in a minute, only after a change; a lock writes again whatever the time', () => {
  const now = 10_000_000;
  assert.equal(snapshotDue({ at: null, revision: null }, 4, now, false), true, 'the first look after opening');
  assert.equal(snapshotDue({ at: now - 30_000, revision: 3 }, 4, now, false), false, 'changed, but less than a minute ago');
  assert.equal(snapshotDue({ at: now - SNAPSHOT_EVERY_MS, revision: 3 }, 4, now, false), true);
  assert.equal(snapshotDue({ at: now - 5 * SNAPSHOT_EVERY_MS, revision: 4 }, 4, now, false), false, 'nothing changed');
  assert.equal(snapshotDue({ at: now - 1_000, revision: 4 }, 4, now, true), true, 'on lock');
});

// ---------------------------------------------------------------------------
// Through the real Engine
// ---------------------------------------------------------------------------

type Clock = { now: number };

function engineAt(t: any, directory: string, keys: DeviceKeyStore, clock: Clock, venture: Record<string, unknown> = {}) {
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file',
    workspaceCustody: { deviceKeys: keys, autoBackups: false, clock: () => clock.now },
    venture: { clock: () => new Date(clock.now), ...venture } });
  t.after(() => engine.close().catch(() => {}));
  return { engine, ask: (method: string, payload: Record<string, unknown> = {}): Promise<any> => engine.request(method, payload) };
}

/** Connects the replay AI and creates a business that opens with this computer, with its venture, through onboarding. */
async function dogBusiness(t: any, directory: string, keys: DeviceKeyStore, clock: Clock) {
  const dog = JSON.parse(await readFile(new URL('./fixtures/venture/onboarding/dog-walking-gb.json', import.meta.url), 'utf8')) as ModelReplayFixture & { text: string };
  const made = engineAt(t, directory, keys, clock, { host: 'test', modelTransport: createReplayTransport(dog), sandbox: { process: async () => { throw new Error('docker not found'); } } });
  const { ask } = made;
  const options = await ask('venture.ai.options') as AiOptionsView;
  const preset = (id: ModelPreset['id']) => options.presets.find(item => item.id === id)!;
  const key = ['sk', 'ant', 'test', 'snapshots', 'not', 'a', 'real', 'key', '0001'].join('-');
  await ask('venture.ai.connect', { presetId: 'anthropic-haiku-5-5', consentDigest: preset('anthropic-haiku-5-5').consentDigest, apiKey: key });
  await ask('venture.ai.connect', { presetId: 'anthropic-sonnet-5-5', consentDigest: preset('anthropic-sonnet-5-5').consentDigest, apiKey: key });
  const decision = await ask('venture.compose.decide', { text: dog.text, countryCode: 'GB' }) as ComposeDecision;
  const plan = await ask('venture.compose.fill', { composeId: decision.composeId }) as ComposedPlan;
  const created = await ask('workspace.create', { name: plan.name.value, pack: 'services', folder: null });
  await ask('venture.create', { idea: dog.text, countryCode: 'GB', workingName: plan.name.value, composeId: plan.composeId, composedDigest: plan.digest });
  return { ...made, folder: created.folder as string, name: plan.name.value as string, key };
}

test('engine: a business that opens with this computer writes its snapshot at most once a minute while it changes and again on lock; no client name is in it', async t => {
  const directory = await folder(t), keys = memoryDeviceKeyStore(), clock = { now: Date.parse('2026-10-18T09:00:00.000Z') };
  const { engine, ask, folder: name, name: business, key } = await dogBusiness(t, directory, keys, clock);
  const store = new WorkspaceSnapshots(directory, () => keys);
  const path = join(directory, 'custody', 'snapshots', `${name}.json`);
  const card = JSON.parse(await readFile(join(directory, 'custody', 'cards', `${name}.json`), 'utf8'));

  await engine.tick();
  const first = await store.read(name, card.vaultId);
  assert.equal(first.read, 'saved');
  assert.equal(first.snapshot!.name, business);
  assert.equal(first.snapshot!.asOf, '2026-10-18T09:00:00.000Z');
  assert.equal(first.snapshot!.money!.currency, 'GBP');
  assert.equal(first.snapshot!.money!.invoiced.amount, '0');
  const written = await readFile(path, 'utf8');

  // A change within the minute waits; after it, the next tick writes.
  await ask('venture.client.add', { name: 'Pemberton Dog Club', email: 'hello@pemberton.example', countryCode: 'GB' });
  clock.now += 20_000;
  await engine.tick();
  assert.equal(await readFile(path, 'utf8'), written, 'not twice in a minute');
  clock.now += SNAPSHOT_EVERY_MS;
  await engine.tick();
  const second = await store.read(name, card.vaultId);
  assert.equal(second.snapshot!.asOf, new Date(clock.now).toISOString());

  clock.now += 5_000;
  await ask('workspace.lock');
  const locked = await store.read(name, card.vaultId);
  assert.equal(locked.snapshot!.asOf, new Date(clock.now).toISOString(), 'written again on lock');
  // The owner's words never reach it: decrypted, it holds no client, email or key.
  const text = JSON.stringify(locked.snapshot);
  for (const word of ['Pemberton', 'pemberton.example', key]) assert.equal(text.includes(word), false, word);
});

test('engine: a passphrase business never writes one, turning the passphrase on removes it, and deleting a business removes it', async t => {
  const directory = await folder(t), keys = memoryDeviceKeyStore(), clock = { now: Date.parse('2026-10-18T09:00:00.000Z') };
  const { engine, ask, folder: name } = await dogBusiness(t, directory, keys, clock);
  const path = join(directory, 'custody', 'snapshots', `${name}.json`);
  await engine.tick();
  await readFile(path);
  const passphrase = 'a long owner passphrase here';
  await ask('workspace.custody.passphraseOn', { passphrase });
  await assert.rejects(readFile(path), code('ENOENT'), 'gone at once, with no tick');
  clock.now += 2 * SNAPSHOT_EVERY_MS;
  await engine.tick();
  await assert.rejects(readFile(path), code('ENOENT'), 'and a tick writes none');
  await ask('workspace.lock');
  await assert.rejects(readFile(path), code('ENOENT'), 'and lock writes none');

  await ask('workspace.open', { folder: name, passphrase });
  await ask('workspace.custody.passphraseOff', { passphrase });
  clock.now += 2 * SNAPSHOT_EVERY_MS;
  await engine.tick();
  await readFile(path);
  const workspace = (await ask('workspace.status')).workspace;
  await ask('workspace.delete', { confirmation: workspace.name });
  await assert.rejects(readFile(path), code('ENOENT'), 'deleted with its business');
});

test('engine: an address blocked in one business is OUTREACH_BLOCKED in another on this computer, through the real chain', async t => {
  const directory = await folder(t), keys = memoryDeviceKeyStore(), clock = { now: Date.parse('2026-10-18T09:00:00.000Z') };
  const { ask, name: first } = await dogBusiness(t, directory, keys, clock);
  await ask('venture.leads.block', { value: 'asha@dewdrop.example' });
  await ask('workspace.lock');
  // The list holds the address as a keyed check only.
  const raw = await readFile(join(directory, 'custody', 'never-contact.json'), 'utf8');
  assert.equal(raw.includes('dewdrop'), false);

  await ask('workspace.create', { name: 'Second Shop', pack: 'services', folder: null });
  await ask('venture.create', { idea: 'Weekly bookkeeping for small cafes in London.', countryCode: 'GB', workingName: 'Second Shop' });
  const lead = await ask('venture.leads.add', { name: 'Asha Rao', email: 'asha@dewdrop.example', sourceUrl: 'https://directory.example/london/cafes' });
  await assert.rejects(ask('venture.leads.draft', { leadId: lead.id, subject: 'Books', body: 'A short note.', postalAddress: '12 High Street, London' }), (error: any) => {
    assert.equal(error.code, 'OUTREACH_BLOCKED');
    assert.equal(error.message, 'Asha Rao is on the never-contact list of your businesses on this computer.');
    return true;
  });
  // Someone not on the list passes the never-contact check and meets the business's own rules (no mail server check
  // here, so their email is not verified): the refusal above is the shared list's, not the lead rules'.
  const other = await ask('venture.leads.add', { name: 'Priya Nair', email: 'priya@neem.example', sourceUrl: 'https://directory.example/london/cafes' });
  await assert.rejects(ask('venture.leads.draft', { leadId: other.id, subject: 'Books', body: 'A short note.', postalAddress: '12 High Street, London' }), code('LEADS_EMAIL_UNVERIFIED'));
  // The first business is listed beside it from its summary.
  const across = await ask('venture.money.across');
  assert.deepEqual(across.businesses.map((row: any) => [row.name, row.lineKey]), [['Second Shop', 'open'], [across.businesses[1].name, 'as-of']]);
  assert.notEqual(across.businesses[1].name, 'Second Shop');
  assert.ok(first);
});

test('engine: on the hosted app no summary is written and the across views show the open business only', async t => {
  const directory = await folder(t), keys = memoryDeviceKeyStore(), clock = { now: Date.parse('2026-10-18T09:00:00.000Z') };
  const { engine, ask } = engineAt(t, directory, keys, clock, { host: 'hosted-web' });
  await ask('workspace.create', { name: 'Hosted Shop', pack: 'services', folder: null });
  await ask('venture.create', { idea: 'Weekly bookkeeping for small cafes in London.', countryCode: 'GB', workingName: 'Hosted Shop' });
  await engine.tick();
  await ask('workspace.lock');
  await ask('workspace.create', { name: 'Hosted Two', pack: 'services', folder: null });
  await ask('venture.create', { idea: 'Weekly bookkeeping for small cafes in London.', countryCode: 'GB', workingName: 'Hosted Two' });
  const across = await ask('venture.money.across');
  assert.deepEqual(across.businesses.map((row: any) => row.name), ['Hosted Two']);
  assert.equal((await ask('venture.runs.across')).businesses.length, 1);
  await assert.rejects(readdir(join(directory, 'custody', 'snapshots')), code('ENOENT'), 'nothing saved on hosted');
  await assert.rejects(readFile(join(directory, 'custody', 'never-contact.json')), code('ENOENT'));
  await assert.rejects(ask('workspace.custody.neverContactReset', { confirmation: 'Hosted Two' }), code('TIER_UNAVAILABLE'));
});

test('engine: a list that can no longer be checked stops drafting until the owner starts a new one with workspace.custody.neverContactReset', async t => {
  const directory = await folder(t), keys = memoryDeviceKeyStore(), clock = { now: Date.parse('2026-10-18T09:00:00.000Z') };
  const { engine, ask } = await dogBusiness(t, directory, keys, clock);
  const business = (await ask('workspace.status')).workspace.name as string;
  await ask('venture.leads.block', { value: 'asha@dewdrop.example' });
  await engine.tick();
  // A list that still checks is never started again.
  await assert.rejects(ask('workspace.custody.neverContactReset', { confirmation: business }), (error: any) => {
    assert.equal(error.code, 'NEVER_CONTACT_OK');
    assert.equal(error.message, 'Your never-contact list on this computer still checks, so there is nothing to start again.');
    return true;
  });
  await rm(join(directory, 'custody', 'never-contact-key.json'));
  const lead = await ask('venture.leads.add', { name: 'Priya Nair', email: 'priya@neem.example', sourceUrl: 'https://directory.example/london/cafes' });
  const fresh = new Engine({ directory, demo: true, storage: 'experimental-file', workspaceCustody: { deviceKeys: keys, autoBackups: false } });
  t.after(() => fresh.close().catch(() => {}));
  await ask('workspace.lock');
  const name = (await fresh.request('workspace.list', {})).businesses[0].folder;
  await assert.rejects(fresh.request('workspace.custody.neverContactReset', { confirmation: business }), code('VAULT_LOCKED'), 'a business must be open');
  await fresh.request('workspace.open', { folder: name });
  await assert.rejects(fresh.request('venture.leads.draft', { leadId: lead.id, subject: 'Books', body: 'A short note.', postalAddress: '12 High Street, London' }), code('NEVER_CONTACT_LOST'));
  // The owner, inside the app, typing the open business's name.
  const owner = fresh.bootstrapContext();
  await assert.rejects(fresh.requestAs({ ...owner, sourceTainted: true }, 'workspace.custody.neverContactReset', { confirmation: business }), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(fresh.requestAs({ ...owner, channel: 'phone' as any }, 'workspace.custody.neverContactReset', { confirmation: business }), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(fresh.request('workspace.custody.neverContactReset', { confirmation: 'Some Other Shop' }), code('CONFIRMATION_REQUIRED'));
  await assert.rejects(fresh.request('workspace.custody.neverContactReset', {}), code('CONFIRMATION_REQUIRED'));
  const reset = await fresh.request('workspace.custody.neverContactReset', { confirmation: business });
  assert.equal(reset.line, "Chausar started a new never-contact list on this computer. Each business adds its own blocklist again the next time you open it. People forgotten in other businesses can't be put back on it.");
  const list = JSON.parse(await readFile(join(directory, 'custody', 'never-contact.json'), 'utf8'));
  assert.equal(list.hashes.length, 1, 'the open business added its own blocklist again');
  const activity = await fresh.request('activity.list', {});
  assert.ok(activity.items.some((item: any) => item.event === 'custody.never-contact-reset'), 'journalled in the audit');
  await assert.rejects(fresh.request('venture.leads.draft', { leadId: lead.id, subject: 'Books', body: 'A short note.', postalAddress: '12 High Street, London' }), code('LEADS_EMAIL_UNVERIFIED'), 'drafting is back to its own rules');
});

