/** Measured store curve on disposable synthetic businesses, shared by the nightly budgets and regression test. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, cpus, release } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../platform/runtime/vault.ts';
import type { PersonRecord } from '../platform/runtime/venture/contracts.ts';

type Sample = { openMs: number; commitMs: number; closeMs: number };
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
export async function measureVaultCurve(sizes = [1_000, 10_000, 50_000], runs = 5) {
  const rows: { records: number; samples: Sample[]; median: Sample }[] = [];
  for (const records of sizes) {
    const directory = await mkdtemp(join(tmpdir(), 'chausar-vault-budget-'));
    const options = { directory, storage: 'experimental-file' as const, passphrase: 'synthetic store curve passphrase' };
    let vault: Vault | undefined;
    try {
      ({ vault } = await Vault.create({ ...options, name: 'Store curve', demo: true }));
      await vault.update(state => {
        state.conversations = Array.from({ length: records }, (_, index): PersonRecord => ({
          id: 'person-' + index, kind: 'venture-person', ventureId: 'sample-venture', memberId: 'owner', epoch: 1,
          at: '2026-01-01T00:00:00.000Z', name: 'Sample person ' + index,
          handles: { emails: [], phones: [], linkedinUrl: null }, role: null, roles: [], facts: [], hidden: false, clientId: null, history: [],
        }));
      });
      await vault.close(); vault = undefined;
      const samples: Sample[] = [];
      for (let run = 0; run < runs; run++) {
        let at = performance.now(); vault = await Vault.open(options); const openMs = performance.now() - at;
        at = performance.now(); await vault.update(state => { state.conversations[0].name = 'Changed sample ' + run; }); const commitMs = performance.now() - at;
        assert.equal(vault.read().conversations[0].name, 'Changed sample ' + run);
        at = performance.now(); await vault.close(); const closeMs = performance.now() - at; vault = undefined;
        samples.push({ openMs, commitMs, closeMs });
      }
      rows.push({ records, samples, median: { openMs: median(samples.map(row => row.openMs)), commitMs: median(samples.map(row => row.commitMs)), closeMs: median(samples.map(row => row.closeMs)) } });
    } finally { await vault?.close(); await rm(directory, { recursive: true, force: true }); }
  }
  return { format: 'chausar.vault-budget/1', at: new Date().toISOString(), node: process.version, platform: process.platform, architecture: process.arch, os: release(), cpu: cpus()[0]?.model ?? 'unknown', runs, rows };
}
