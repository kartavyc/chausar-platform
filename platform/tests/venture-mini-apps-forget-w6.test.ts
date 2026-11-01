// W6 6H1 (DPDP): forgetting a client also clears them from mini app notes and the app's making chat.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { MiniAppRecord } from '../runtime/venture/contracts.ts';
import { APP_ERASED_LINE, eraseAppNaming } from '../runtime/venture/apps/privacy.ts';

function app(notes: Record<string, string>, messages: MiniAppRecord['messages']): MiniAppRecord {
  return { id: 'app_1', kind: 'venture-mini-app', ventureId: 'v', memberId: 'owner', epoch: 1, at: '2026-11-01T10:00:00.000Z', name: 'Follow-ups', versions: [], current: 1, grant: null, pinned: false, notes, messages } as unknown as MiniAppRecord;
}

function tx(records: MiniAppRecord[]) {
  const events: string[] = [];
  return {
    events, records,
    list: () => records,
    replace: (next: MiniAppRecord) => { records[records.findIndex(r => r.id === next.id)] = next; return next; },
    emit: (type: string) => { events.push(type); },
  };
}

const mentions = (value: unknown) => /Asha Rao/i.test(String(value));

test('notes that name a forgotten client, hold their client id or one of their addresses are removed; the rest stay', () => {
  const t = tx([app({ 'next:client_9': 'call Friday', asha: 'Asha Rao owes a reply', mail: 'write to asha@example.com', other: 'Ravi paid' }, [])]);
  eraseAppNaming(t as never, new Set(['client_9']), new Set(['asha@example.com']), mentions);
  assert.deepEqual(t.records[0]!.notes, { other: 'Ravi paid' });
  // Forget itself emits privacy.forgotten; the eraser adds no event of its own.
  assert.deepEqual(t.events, []);
});

test("the making chat's messages that name them are replaced by the erased line, with their time and version kept", () => {
  const t = tx([app({}, [
    { at: '2026-11-01T10:00:00.000Z', from: 'owner', text: 'A tracker for Asha Rao and her invoices', version: null },
    { at: '2026-11-01T10:00:01.000Z', from: 'chausar', text: 'Made version 1.', version: 1 },
  ])]);
  eraseAppNaming(t as never, new Set(), new Set(), mentions);
  assert.equal(t.records[0]!.messages[0]!.text, APP_ERASED_LINE);
  assert.equal(t.records[0]!.messages[0]!.at, '2026-11-01T10:00:00.000Z');
  assert.equal(t.records[0]!.messages[1]!.text, 'Made version 1.');
});

test('an app that names nobody forgotten is left as it is', () => {
  const record = app({ other: 'Ravi paid' }, [{ at: '2026-11-01T10:00:00.000Z', from: 'owner', text: 'A follow-up list', version: null }]);
  const t = tx([record]);
  eraseAppNaming(t as never, new Set(['client_9']), new Set(['asha@example.com']), mentions);
  assert.equal(t.records[0], record);
  assert.deepEqual(t.events, []);
});
