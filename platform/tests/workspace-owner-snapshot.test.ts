import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { ChausarError, type Context, type State } from '../runtime/contracts.ts';

// Actual Engine composition and encrypted C-temp Vault. Direct trusted-owner
// calls isolate their read cost; public backup refusals independently check that
// withdrawn current authority cannot publish. No server, native SQL or provider.
const sourceId = 'synthetic-owner-snapshot-source';
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;
type OwnerGuards = {
  backupCompleteOwner(context: Context, historical: State): void;
  interchangeOwner(context: Context, historical: State): void;
};
const guardNames = ['backupCompleteOwner', 'interchangeOwner'] as const;

async function fixture(t: TestContext) {
  const base = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(base, /^C:\\/i);
  const directory = await realpath(await mkdtemp(join(base, 'chausar-owner-snapshot-')));
  assert.equal(dirname(directory), base);
  let providerCalls = 0;
  const engine = new Engine({ directory, storage: 'experimental-file', demo: true,
    gateway: { http: async () => { providerCalls++; throw new Error('Synthetic owner fixture forbids provider calls.'); } } });
  t.after(async () => {
    await engine.close();
    const actual = await realpath(directory);
    assert.equal(dirname(actual), base); assert.match(actual.split(/[\\/]/).at(-1)!, /^chausar-owner-snapshot-/);
    await rm(actual, { recursive: true, force: true }); assert.equal(providerCalls, 0);
  });
  await engine.request('workspace.create', { name: 'Synthetic owner snapshot fixture',
    passphrase: 'Synthetic owner snapshot passphrase', pack: 'retail', demo: false });
  const vault = engine.vault!;
  await vault.update(state => {
    state.policy.allowedSources = [sourceId];
    state.facts = Array.from({ length: 40 }, (_, index) => ({ id: `synthetic_fact_${index}`,
      entityId: `synthetic_invoice_${index}`, sourceId, sourceRow: index + 1, kind: 'invoice',
      branch: 'main', validFrom: '2026-09-01', validTo: null, learnedAt: new Date().toISOString(), supersededAt: null,
      fields: { amountMinor: '100', currency: 'INR', status: 'issued' } }));
  });
  const historical = vault.read(), guards = engine as unknown as OwnerGuards;
  return { engine, vault, historical, guards };
}

test('actual Engine owner guards read the Vault a constant number of times for forty historical facts', async t => {
  const f = await fixture(t), originalRead = f.vault.read.bind(f.vault);
  const measurements: { guard: string; singleFactReads: number; fortyFactReads: number }[] = [];
  let reads = 0;
  f.vault.read = () => { reads++; return originalRead(); };
  try {
    for (const guard of guardNames) {
      reads = 0; f.guards[guard](owner, { ...f.historical, facts: f.historical.facts.slice(0, 1) });
      const singleFactReads = reads;
      reads = 0; f.guards[guard](owner, f.historical);
      measurements.push({ guard, singleFactReads, fortyFactReads: reads });
    }
  } finally { f.vault.read = originalRead; }
  t.diagnostic(JSON.stringify({ actualEncryptedVault: true, historicalFacts: 40, measurements, nativeQualified: false }));
  for (const result of measurements) {
    assert.ok(result.fortyFactReads <= 8, `${result.guard}: synchronous row access must reuse this invocation's fresh current State.`);
    assert.equal(result.fortyFactReads, result.singleFactReads, `${result.guard}: current Vault read count must not grow with retained row count.`);
  }
  assert.deepEqual(f.vault.read(), f.historical, 'Read-only admission must retain exact source authority.');
  assert.deepEqual(await f.vault.listArtifacts({ purpose: 'workspace-interchange' }), []);
});

test('actual Engine owner snapshots refresh for durable authority and source-access withdrawals before publication', async t => {
  const f = await fixture(t), baseline = f.vault.read();
  const changes: { name: string; expected: string; change: (state: State) => void }[] = [
    { name: 'inactive-owner', expected: 'ACCESS_REVOKED', change: state => { state.members[0].active = false; } },
    { name: 'owner-epoch', expected: 'ACCESS_REVOKED', change: state => { state.members[0].epoch++; } },
    { name: 'source-policy', expected: 'SOURCE_REVOKED', change: state => { state.policy.allowedSources = ['different-synthetic-source']; } },
    { name: 'source-rule', expected: 'SOURCE_REVOKED', change: state => { state.sourceRules.push({ id: 'withdrawn_source_rule', sourceId, allow: false }); } },
    { name: 'source-tombstone', expected: 'SOURCE_REVOKED', change: state => { state.tombstones.push({ id: 'withdrawn_source', sourceId, kind: 'source' }); } },
  ];
  for (const change of changes) await t.test(change.name, async () => {
    await f.vault.update(state => {
      state.members = structuredClone(baseline.members); state.policy = structuredClone(baseline.policy);
      state.sourceRules = structuredClone(baseline.sourceRules); state.tombstones = structuredClone(baseline.tombstones);
    });
    for (const guard of guardNames) assert.equal(f.guards[guard](owner, f.historical), undefined);
    await f.vault.update(change.change);
    const withdrawn = f.vault.read();
    for (const guard of guardNames) assert.throws(() => f.guards[guard](owner, f.historical), code(change.expected));
    await assert.rejects(f.engine.requestAs(owner, 'workspace.backup.v2.create', {
      destinationId: `refused_${change.name.replaceAll('-', '_')}`, confirmed: true,
    }), code(change.expected));
    assert.deepEqual(f.vault.read(), withdrawn, 'Refusal must not rewrite the revoked source authority.');
    assert.deepEqual(await f.vault.listArtifacts({ purpose: 'workspace-interchange' }), [], 'Withdrawn access cannot publish archive, pin or binding artifacts.');
  });
});
