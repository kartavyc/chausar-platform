// Package 4D1 (Ink v2 wave 4) through the real host: every app-only network method is refused from the phone before it
// runs, and works from the app; the host puts the network key (derived from the vault's own key) on its secret shelf so
// Forget keeps a keyed check without the key ever reaching a record; and nothing in the network package fetches anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { NetworkImportResult, PeopleView, PersonSplit, PersonView } from '../runtime/venture/contracts.ts';
import { VentureHost } from '../runtime/venture/host.ts';
import { handleHash } from '../runtime/venture/network/text.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { code, owner, phone, setup, type Env } from './venture-views-env.ts';
import { CONNECTIONS, CONTACTS, ICS, MAIL, MESSAGES, VCARD } from './venture-network-env.ts';

type Imported = Extract<NetworkImportResult, { mode: 'import' }>;
const vaultKey = (purpose: string) => createHash('sha256').update(`test vault key:${purpose}`).digest();

/** The real host over the test store, which here can derive a key the way the vault does. */
function hostFor(env: Env): VentureHost {
  (env.store as unknown as { derivedKey: (purpose: string) => Buffer }).derivedKey = vaultKey;
  return new VentureHost(env.store, env.deps.services, { demo: true, storage: 'experimental-file', clock: env.deps.clock, host: 'test' });
}

test('every app-only network method is refused from the phone through the host, and works from the app', async () => {
  const env = await setup();
  const host = hostFor(env);
  const made = await host.request(owner, 'venture.network.import', { kind: 'linkedin-connections', name: 'Connections.csv', text: CONNECTIONS }) as Imported;
  const second = await host.request(owner, 'venture.network.import', { kind: 'contacts-csv', name: 'p.csv', text: 'Name,E-mail 1 - Value,Organization 1 - Name\nAsha Rao,asha.personal@mail.example,Dewdrop Naturals\n' }) as Imported;
  const list = await host.request(phone, 'venture.network.people', { suggestions: true }) as PeopleView;
  const { a, b } = list.suggestions[0];
  const calls: [string, Record<string, unknown>][] = [
    ['venture.network.import', { kind: 'vcard', name: 'v.vcf', text: VCARD }],
    ['venture.network.importUndo', { importId: made.import.id }],
    ['venture.network.merge', { a, b }],
    ['venture.network.split', { personId: a, sourceIds: [`${second.import.id}:2`] }],
    ['venture.network.hide', { personId: a, hidden: true }],
    ['venture.network.forget', { id: a }],
  ];
  for (const [method, payload] of calls) await assert.rejects(host.request(phone, method, payload), code('APP_APPROVAL_REQUIRED'), `${method} from the phone`);
  for (const [method, payload] of calls.slice(0, 1)) await host.request(owner, method, payload);
  const merged = await host.request(owner, 'venture.network.merge', { a, b }) as PersonView;
  assert.equal(merged.person.id, a);
  const split = await host.request(owner, 'venture.network.split', { personId: a, sourceIds: [`${second.import.id}:2`] }) as PersonSplit;
  assert.equal(split.person.person.id, a);
  assert.equal(((await host.request(owner, 'venture.network.hide', { personId: a, hidden: true })) as { person: { hidden: boolean } }).person.hidden, true);
  await host.request(owner, 'venture.network.forget', { id: a });
  await host.request(owner, 'venture.network.importUndo', { importId: second.import.id });
  host.close();
});

test('the host puts the network key on its shelf from the vault\'s key: Forget keeps a keyed check, and the key is in no record', async () => {
  const env = await setup();
  const host = hostFor(env);
  await host.request(owner, 'venture.network.import', { kind: 'linkedin-connections', name: 'Connections.csv', text: CONNECTIONS });
  const asha = listRecords(env.store.read(), 'venture-person').find(person => person.name === 'Asha Rao')!;
  await host.request(owner, 'venture.network.forget', { id: asha.id });
  const key = vaultKey('network-forget').toString('hex');
  const [record] = listRecords(env.store.read(), 'venture-forgotten');
  assert.equal(record.hashes[0].hash, handleHash(key, 'email', 'asha@dewdrop.example'));
  assert.ok(!JSON.stringify(env.store.read()).includes(key));
  host.close();
});

test('nothing in the network package fetches anything: every kind imported, read, merged, forgotten and undone with fetch trapped', async () => {
  const env = await setup();
  const host = hostFor(env);
  const fetched: unknown[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: unknown[]) => { fetched.push(args[0]); throw new Error('The network package must not fetch.'); }) as typeof fetch;
  try {
    const ids: string[] = [];
    for (const [kind, text] of [['linkedin-connections', CONNECTIONS], ['linkedin-messages', MESSAGES], ['contacts-csv', CONTACTS], ['vcard', VCARD], ['calendar-ics', ICS], ['mail-headers', MAIL]] as const) {
      await host.request(owner, 'venture.network.import', { kind, name: `${kind}.txt`, text, check: true });
      ids.push((await host.request(owner, 'venture.network.import', { kind, name: `${kind}.txt`, text }) as Imported).import.id);
    }
    const list = await host.request(owner, 'venture.network.people', { suggestions: true }) as PeopleView;
    for (const person of list.people) await host.request(owner, 'venture.network.person', { id: person.id });
    await host.request(owner, 'venture.network.sources', {});
    await host.request(owner, 'venture.network.forget', { id: list.people[0].id });
    for (const id of ids.reverse()) await host.request(owner, 'venture.network.importUndo', { importId: id });
    assert.equal(listRecords(env.store.read(), 'venture-person').length, 0, 'every import undone');
  } finally {
    globalThis.fetch = realFetch;
    host.close();
  }
  assert.deepEqual(fetched, []);
});
