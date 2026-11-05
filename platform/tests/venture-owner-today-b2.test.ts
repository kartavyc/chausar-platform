// One-shot B2, the task after task 3 (the founder's answer of 5 Nov): the engine spots that took "today" as the UTC
// day now take the owner's day, by the business's country and the engine's own zone table (local-day.ts). At 00:30 in
// India on 22 Oct, UTC still says 21 Oct; the owner's day is 22 Oct.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '../runtime/contracts.ts';
import type { VentureDeps } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { applySiteEdit, localFolderTarget, stageSiteEdit } from '../runtime/venture/build/site-edits.ts';
import { ventureTimeZone } from '../runtime/venture/local-day.ts';
import { VentureTestStore } from './venture-test-store.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
/** 00:30 in India on 22 Oct 2026; UTC is still on 21 Oct. */
const LATE = Date.parse('2026-10-21T19:00:00.000Z');

async function seeded(country: { code: string } | null) {
  const store = new VentureTestStore();
  const deps = { store, clock: () => new Date(LATE) } as unknown as VentureDeps;
  await ventureAction(deps, owner, 'admin', 'seed', tx => tx.put({
    ...tx.base('venture-record'), idea: 'Monthly books for cafes in Pune', ideaDigest: 'synthetic', workingName: 'Ledger Cafe Books', country,
    serviceType: 'bookkeeping', status: 'live', launchStage: 'approve-each', blueprintId: null, acceptedBlueprintId: null, playbookId: null,
    invoiceSequence: 0, updatedAt: tx.now,
  } as any), { create: true });
  return deps;
}

async function readBackDay(country: { code: string } | null): Promise<string | undefined> {
  const root = await mkdtemp(join(tmpdir(), 'chausar-owner-today-'));
  try {
    await writeFile(join(root, 'index.html'), '<p>Open 9 to 5</p>');
    const deps = await seeded(country);
    const target = await localFolderTarget(root);
    const staged = await stageSiteEdit(deps, owner, target, { path: 'index.html', after: '<p>Open 8 to 6</p>', summary: 'New hours' });
    await applySiteEdit(deps, owner, target, { editId: staged.id, planDigest: staged.planDigest });
    const entry = listRecords(deps.store.read(), 'venture-journal-entry').find(item => item.action === 'site.apply')!;
    return entry.ends?.at(-1)?.check?.checkedOn;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('a website read back at 00:30 in India is dated the owner\'s day, not the UTC day', async () => {
  assert.equal(await readBackDay({ code: 'IN' }), '2026-10-22');
  assert.equal(await readBackDay({ code: 'US' }), '2026-10-21');
  // A business still in its interview has no country yet: the engine's fallback, UTC, as before.
  assert.equal(await readBackDay(null), '2026-10-21');
  assert.equal(ventureTimeZone(null), 'UTC');
});

test('none of the listed spots reads the UTC day or a fixed India offset any more', () => {
  const root = join(import.meta.dirname, '../runtime/venture');
  for (const file of [
    'delivery/runs.ts', 'playbooks/social/run-guard.ts', 'build/site-edits.ts', 'agent-runtime/native-job.ts',
    'playbooks/online-seller/photos-desk.ts', 'playbooks/online-seller/model.ts',
    // Found while building: the journal refused an owner's-day check as dated after today.
    'journal/end-states.ts',
  ]) {
    const text = readFileSync(join(root, file), 'utf8');
    // Tested with .test so a failure names the file, not the whole file's text.
    assert.ok(!/(?:clock\(\)|new Date\(\)|Date\.now\(\)[^;]*)\.toISOString\(\)\.slice\(0, ?10\)/.test(text), file);
    assert.ok(!/tx\.now\.slice\(0, ?10\)/.test(text), file);
    assert.ok(!/19800000|330 \* 60/.test(text), file);
  }
});
