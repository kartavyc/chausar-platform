import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context } from '../runtime/contracts.ts';

// Synthetic people and entries only. TL-03: delete one follow-up and export the book.
const code = (name: string) => (e: any) => { assert.equal(e.code, name, e.message); return true; };

async function fixture(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-followup-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.shutdown?.(5000).catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic follow-ups', passphrase: 'Synthetic-followup-fixture', demo: false });
  const owner = { ...engine.bootstrapContext(), channel: 'desktop' as const };
  const as = (ctx: Context, method: string, payload: any = {}) => engine.requestAs(ctx, method, payload);
  const book = () => ((engine.vault!.read().extensions as any)?.['models-ext']?.smallApps?.book ?? []) as any[];
  const auditEvents = () => (engine.vault!.read() as any).activity.map((a: any) => a.event) as string[];
  return { engine, owner, as, book, auditEvents, directory };
}

test('delete removes one entry with its whole history, against the version read, and audits only its id', async t => {
  const f = await fixture(t);
  const a = (await f.as(f.owner, 'smallapps.records.add', { who: 'Synthetic Traders', when: '2026-10-09', said: 'Will pay Friday' }) as any).entry;
  const b = (await f.as(f.owner, 'smallapps.records.add', { who: 'Synthetic Stores', when: '2026-10-10' }) as any).entry;
  await f.as(f.owner, 'smallapps.records.update', { id: a.id, expectedVersion: 1, status: 'done' });
  await assert.rejects(f.as(f.owner, 'trustx.followUpDelete', { id: a.id, expectedVersion: 1 }), code('FOLLOW_UP_CONFLICT'));
  await assert.rejects(f.as(f.owner, 'trustx.followUpDelete', { id: 'followup_missing', expectedVersion: 1 }), code('FOLLOW_UP_NOT_FOUND'));
  await assert.rejects(f.as(f.owner, 'trustx.followUpDelete', { id: a.id }), code('FOLLOW_UP_INVALID'));
  await assert.rejects(f.as(f.owner, 'trustx.followUpDelete', { id: a.id, expectedVersion: 2, extra: 1 }), code('INVALID_FIELDS'));
  const deleted = await f.as(f.owner, 'trustx.followUpDelete', { id: a.id, expectedVersion: 2 }) as any;
  assert.deepEqual(deleted, { deleted: true, id: a.id, versionsRemoved: 2 });
  assert.deepEqual(f.book().map(e => e.id), [b.id]);
  await assert.rejects(f.as(f.owner, 'smallapps.records.history', { id: a.id }), code('SMALLAPP_RECORD_NOT_FOUND'));
  assert.ok(f.auditEvents().includes('smallapp.followup.deleted'));
  const line = (f.engine.vault!.read() as any).activity.find((x: any) => x.event === 'smallapp.followup.deleted');
  assert.equal(JSON.stringify(line).includes('Will pay'), false);
});

test('delete and export refuse outside the app, after outside text, and for someone else\'s entry', async t => {
  const f = await fixture(t);
  await f.as(f.owner, 'members.add', { id: 'acc', name: 'Synthetic accountant', role: 'accountant' });
  const accountant: Context = { memberId: 'acc', role: 'accountant', epoch: 1, channel: 'desktop' };
  const mine = (await f.as(f.owner, 'smallapps.records.add', { who: 'Synthetic Traders', when: '2026-10-09' }) as any).entry;
  await assert.rejects(f.as({ ...f.owner, sourceTainted: true }, 'trustx.followUpDelete', { id: mine.id, expectedVersion: 1 }), code('FOLLOW_UP_TAINTED_CONTEXT'));
  await assert.rejects(f.as({ ...f.owner, channel: 'mcp' }, 'trustx.followUpExport', {}), (e: any) => typeof e.code === 'string');
  await assert.rejects(f.as(accountant, 'trustx.followUpDelete', { id: mine.id, expectedVersion: 1 }), code('FOLLOW_UP_FORBIDDEN'));
  const theirs = (await f.as(accountant, 'smallapps.records.add', { who: 'Synthetic Mills', when: '2026-10-11' }) as any).entry;
  assert.equal((await f.as(accountant, 'trustx.followUpDelete', { id: theirs.id, expectedVersion: 1 }) as any).deleted, true);
  assert.equal(f.book().length, 1);
});

test('export writes the visible book as a guarded CSV on this computer, not encrypted', async t => {
  const f = await fixture(t);
  await f.as(f.owner, 'smallapps.records.add', { who: '=HYPERLINK("x")', when: '2026-10-12', said: 'Said "later", then hung up' });
  await f.as(f.owner, 'smallapps.records.add', { who: 'Synthetic Traders', when: '2026-10-09', said: 'Will pay Friday' });
  await assert.rejects(f.as(f.owner, 'trustx.followUpExport', { format: 'xlsx' }), code('INVALID_FIELDS'));
  const out = await f.as(f.owner, 'trustx.followUpExport', {}) as any;
  assert.equal(out.rows, 2); assert.equal(out.encrypted, false); assert.match(out.sha256, /^[a-f0-9]{64}$/);
  assert.ok(out.path.startsWith(join(f.directory, 'exports', 'follow-up')));
  const text = await readFile(out.path, 'utf8');
  const lines = text.trim().split('\n');
  assert.equal(lines[0], 'entry,customer,written,said,next,status,version,earlier_versions_withheld');
  assert.match(lines[1]!, /,Synthetic Traders,\d{4}-\d{2}-\d{2},Will pay Friday,2026-10-09,open,1,0$/);
  assert.match(lines[2]!, /,"'=HYPERLINK\(""x""\)",/);
  assert.equal(Buffer.byteLength(text), out.bytes);
  assert.equal((await stat(out.path)).mode & 0o777, 0o600);
  assert.ok(f.auditEvents().includes('smallapp.followup.exported'));
});
