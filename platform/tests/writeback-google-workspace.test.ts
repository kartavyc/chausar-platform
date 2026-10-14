import test from 'node:test';
import assert from 'node:assert/strict';
import { googleWorkspaceAdapters } from '../runtime/writeback/systems/google-workspace.ts';
import { GoogleWorkspaceFake, googleSeed, practiceSpreadsheetId } from '../fakes/google-workspace/index.ts';
import { cycle, fakeContext, practiceConnection } from '../fakes/harness.ts';

function setup(token = googleSeed.token) {
  const fake = new GoogleWorkspaceFake();
  const ctx = fakeContext(fake, practiceConnection('google-workspace', { spreadsheetId: practiceSpreadsheetId }), { accessToken: token });
  return { fake, ctx };
}
const sheet = practiceSpreadsheetId, rowPayload = { spreadsheetId: sheet, sheet: 'Ledger', values: ['2026-10-14', 'Chitra Stores (synthetic)', '2500.00', 'Cash sale'] };
const event = { calendarId: 'primary', summary: 'Call Asha Traders about September dues (synthetic)', start: '2026-10-20T05:30:00Z', end: '2026-10-20T06:00:00Z', timeZone: 'Asia/Kolkata' };

test('a sheet row is appended once with its reference in column A, and a repeat finds it instead of appending another', async () => {
  const { fake, ctx } = setup(); const adapter = googleWorkspaceAdapters['sheets.append'];
  const first = await cycle(adapter, ctx, rowPayload, 'effect-key-row-1');
  assert.equal(first.observation.outcome, 'confirmed-applied');
  const ledger = fake.spreadsheets[sheet].tabs.Ledger, reference = String(first.preparation.postconditions.reference);
  assert.match(reference, /^CHS-[0-9A-F]{16}$/);
  assert.deepEqual(ledger[2], [reference, ...rowPayload.values]);
  assert.equal(first.receipt?.externalId, "'Ledger'!A3:E3");
  const again = await cycle(adapter, ctx, rowPayload, 'effect-key-row-1');
  assert.ok(again.preparation.alreadyApplied); assert.equal(again.receipt, null);
  assert.equal(again.observation.outcome, 'confirmed-applied');
  assert.equal(ledger.length, 3);
  assert.ok(fake.log.some(entry => entry.method === 'POST' && entry.target.includes(':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS')));
});

test('a lost append reply is settled by reading back exactly one row, never by appending again', async () => {
  const { fake, ctx } = setup();
  fake.fault('drop-after-commit');
  const result = await cycle(googleWorkspaceAdapters['sheets.append'], ctx, rowPayload, 'effect-key-row-2');
  assert.equal(result.doError, 'FAKE_CONNECTION_LOST');
  assert.equal(result.observation.outcome, 'confirmed-applied');
  const reference = String(result.preparation.postconditions.reference);
  assert.equal(fake.spreadsheets[sheet].tabs.Ledger.filter(row => row[0] === reference).length, 1);
  fake.spreadsheets[sheet].tabs.Ledger.push([reference, 'copied by hand']);
  assert.equal((await googleWorkspaceAdapters['sheets.append'].readBack(ctx, googleWorkspaceAdapters['sheets.append'].validate(rowPayload), result.preparation, 'effect-key-row-2', null)).outcome, 'conflicting');
});

test('cells that start with a formula sign are refused, so nothing can make the sheet compute', () => {
  for (const bad of ['=HYPERLINK("http://x")', '+1', '-1+2', '@SUM(A1)', '\t=1']) {
    assert.throws(() => googleWorkspaceAdapters['sheets.append'].validate({ ...rowPayload, values: ['ok', bad] }), { code: 'INVALID_WRITE_PAYLOAD' });
    assert.throws(() => googleWorkspaceAdapters['sheets.update'].validate({ spreadsheetId: sheet, range: 'Summary!B2', values: [[bad]] }), { code: 'INVALID_WRITE_PAYLOAD' });
  }
  assert.throws(() => googleWorkspaceAdapters['sheets.append'].validate({ ...rowPayload, values: ['ok', 5] }), { code: 'INVALID_WRITE_PAYLOAD' });
  assert.throws(() => googleWorkspaceAdapters['sheets.update'].validate({ spreadsheetId: sheet, range: 'Summary!B2:C2', values: [['1.00']] }), { code: 'INVALID_WRITE_PAYLOAD' });
  assert.throws(() => googleWorkspaceAdapters['sheets.update'].validate({ spreadsheetId: sheet, range: 'Summary!B2:C2;DROP', values: [['1', '2']] }), { code: 'INVALID_WRITE_PAYLOAD' });
});

test('a cell update previews before and after, writes once, and refuses when the range changed after the preview', async () => {
  const { fake, ctx } = setup(); const adapter = googleWorkspaceAdapters['sheets.update'];
  const update = { spreadsheetId: sheet, range: 'Summary!B2:C2', values: [['120.00', '95.00']] };
  const done = await cycle(adapter, ctx, update, 'effect-key-cells-1');
  assert.deepEqual((done.preparation.preview as any).fields, [{ name: 'B2', before: '100.00', after: '120.00' }, { name: 'C2', before: '80.00', after: '95.00' }]);
  assert.equal(done.observation.outcome, 'confirmed-applied');
  assert.deepEqual(fake.spreadsheets[sheet].tabs.Summary[1], ['2026-09', '120.00', '95.00']);
  const payload = adapter.validate({ spreadsheetId: sheet, range: "'Summary'!B3:C3", values: [['10.00', '']] });
  const preparation = await adapter.prepare(ctx, payload, 'effect-key-cells-2');
  assert.deepEqual((preparation.preview as any).fields, [{ name: 'B3', before: '', after: '10.00' }, { name: 'C3', before: '', after: '' }]);
  fake.spreadsheets[sheet].tabs.Summary.push(['2026-10', '7.00']);
  await assert.rejects(adapter.do(ctx, payload, preparation, 'effect-key-cells-2'), { code: 'WRITE_PRECONDITION_FAILED' });
  assert.deepEqual(fake.spreadsheets[sheet].tabs.Summary[2], ['2026-10', '7.00']);
});

test('a calendar event is created once under an id from the effect key, a 409 is settled by reading back, and guests are refused', async () => {
  const { fake, ctx } = setup(); const adapter = googleWorkspaceAdapters['calendar.createEvent'];
  const first = await cycle(adapter, ctx, event, 'effect-key-event-1');
  assert.equal(first.observation.outcome, 'confirmed-applied');
  assert.match(String(first.receipt?.externalId), /^[a-v0-9]{5,1024}$/);
  assert.ok(fake.log.some(entry => entry.method === 'POST' && entry.target.endsWith('/events?sendUpdates=none')));
  const again = await cycle(adapter, ctx, event, 'effect-key-event-1');
  assert.ok(again.preparation.alreadyApplied); assert.equal(fake.calendars.primary.events.length, 1);

  const payload = adapter.validate({ ...event, summary: 'Stock count (synthetic)' });
  const preparation = await adapter.prepare(ctx, payload, 'effect-key-event-2');
  fake.calendars.primary.events.push({ id: preparation.command.id, status: 'confirmed', summary: 'Stock count (synthetic)', start: { dateTime: '2026-10-20T11:00:00+05:30' }, end: { dateTime: '2026-10-20T11:30:00+05:30' } });
  const receipt = await adapter.do(ctx, payload, preparation, 'effect-key-event-2');
  assert.equal(receipt.outcome, 'provider-claims-applied'); assert.deepEqual(receipt.data, { duplicate: true });
  assert.equal((await adapter.readBack(ctx, payload, preparation, 'effect-key-event-2', receipt)).outcome, 'confirmed-applied');
  fake.calendars.primary.events.at(-1)!.status = 'cancelled';
  assert.equal((await adapter.readBack(ctx, payload, preparation, 'effect-key-event-2', receipt)).outcome, 'conflicting');

  assert.throws(() => adapter.validate({ ...event, attendees: [{ email: 'someone@asha.example' }] }), { code: 'INVALID_WRITE_PAYLOAD' });
  assert.throws(() => adapter.validate({ ...event, end: event.start }), { code: 'INVALID_DATE' });
});

test('a Drive file is uploaded once with its app property, read back by search, and never shared', async () => {
  const { fake, ctx } = setup(); const adapter = googleWorkspaceAdapters['drive.createFile'];
  const content = Buffer.from('date,party,amount\n2026-10-14,Chitra Stores (synthetic),2500.00\n').toString('base64');
  const payload = { name: 'October sales (synthetic).csv', mimeType: 'text/csv', contentBase64: content, folderId: '1PracticeFolderSynthetic0001' };
  const first = await cycle(adapter, ctx, payload, 'effect-key-file-1');
  assert.equal(first.observation.outcome, 'confirmed-applied');
  assert.equal((first.observation as any).observed.size, '63');
  const stored = fake.files.find(f => f.id === first.receipt?.externalId)!;
  assert.equal(Buffer.from(stored.content, 'base64').toString('utf8'), Buffer.from(content, 'base64').toString('utf8'));
  assert.deepEqual(stored.parents, ['1PracticeFolderSynthetic0001']); assert.deepEqual(stored.permissions, []);
  const again = await cycle(adapter, ctx, payload, 'effect-key-file-1');
  assert.ok(again.preparation.alreadyApplied); assert.equal(fake.files.length, 2);
  assert.ok(!fake.log.some(entry => /permissions/.test(entry.target)));
  assert.throws(() => adapter.validate({ ...payload, mimeType: 'application/vnd.google-apps.document' }), { code: 'INVALID_WRITE_PAYLOAD' });
  assert.throws(() => adapter.validate({ ...payload, contentBase64: 'not base64!' }), { code: 'INVALID_WRITE_PAYLOAD' });
});

test('a wrong token is refused with a fixed code', async () => {
  const { ctx } = setup('wrong');
  await assert.rejects(cycle(googleWorkspaceAdapters['sheets.append'], ctx, rowPayload, 'effect-key-x-1'), { code: 'WRITE_AUTH_REFUSED' });
  await assert.rejects(cycle(googleWorkspaceAdapters['calendar.createEvent'], ctx, event, 'effect-key-x-2'), { code: 'WRITE_AUTH_REFUSED' });
});
