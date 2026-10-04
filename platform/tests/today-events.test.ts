import test from 'node:test';
import assert from 'node:assert/strict';
import { type Context } from '../runtime/contracts.ts';
import { IntlCalendarRules } from '../runtime/calendar-zone.ts';
import { ImportService, demoRecipe } from '../runtime/ingest.ts';
import { LearningService } from '../runtime/learning.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';
import { TodayEventsService } from '../runtime/today-events.ts';
import { FixtureStateStore } from './database-fixtures.ts';

// Synthetic CSV values and transplanted audit instants test display dates only.
// Import, learning integrity, source access and branch authority use real services.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
const request = { date: '2026-10-04', timeZone: 'Etc/UTC' };
const rules = () => new IntlCalendarRules({ timeZones: ['Etc/UTC', 'Asia/Kolkata', 'America/New_York'], minYear: 2026, maxYear: 2026, maxCachedLocalTimes: 0 });
async function setup(count = 1) {
  const store = new FixtureStateStore();
  await new OntologyService(store).publish(owner, 'retail');
  const imports = new ImportService(store), learning = new LearningService(store), trust = new TrustService(store);
  for (let i = 0; i < count; i++) await imports.commit(owner, {
    sourceId: `source-${i}`, format: 'csv', recipe: structuredClone(demoRecipe), expectedTotals: { rowCount: 1, amountMinor: '10000' },
    content: `id,kind,date,amount,currency,customerId,invoiceId,orderId,dueDate,status,description,branch\ninvoice-${i},invoice,2026-09-01,100.00,INR,customer-${i},invoice-${i},,,settled,PRIVATE SOURCE PROSE,main\n`,
  });
  await store.update(state => { state.activity = state.activity.filter(item => item.event === 'source.imported');
    state.activity.forEach((item, i) => { item.id = `event-${String(i).padStart(2, '0')}`; item.at = `2026-10-04T10:${String(i).padStart(2, '0')}:00.000Z`; }); });
  return { store, imports, learning, trust, service: new TodayEventsService({ store, rules: rules(), services: { learning } }) };
}

test('day reads preserve audit identity and write no state or repeated business events', async () => {
  const f = await setup(), before = f.store.read();
  const first = f.service.day(owner, request), second = f.service.day(owner, request);
  assert.deepEqual(first, second); assert.deepEqual(f.store.read(), before);
  assert.equal(first.state.kind, 'complete'); assert.equal(first.total, 1);
  assert.equal(first.events[0]!.kind, 'source.imported'); assert.equal(first.events[0]!.id, 'event-00');
  assert.equal(first.events[0]!.at, '2026-10-04T10:00:00.000Z');
  assert.deepEqual(first.events[0]!.actor, { kind: 'member', memberId: 'owner' });
  assert.ok(Object.isFrozen(first.events[0]!.args));
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE SOURCE PROSE|retainedInput|details|totalsMinor|explanation|name/);
});

test('local midnight uses the explicit displayed date in a fractional-offset zone', async () => {
  const f = await setup(4);
  await f.store.update(state => state.activity.forEach((item, i) => { item.at = [
    '2026-10-03T18:29:59.999Z', '2026-10-03T18:30:00.000Z', '2026-10-04T18:29:59.999Z', '2026-10-04T18:30:00.000Z',
  ][i]; }));
  const value = f.service.day(owner, { date: '2026-10-04', timeZone: 'Asia/Kolkata' });
  assert.deepEqual(value.events.map(item => item.id), ['event-02', 'event-01']); assert.equal(value.total, 2);
  assert.equal(f.service.day(owner, request).total, 2);
});

test('spring DST display day has 23 hours and includes both midnight boundaries correctly', async () => {
  const f = await setup(6);
  await f.store.update(state => state.activity.forEach((item, i) => { item.at = [
    '2026-03-08T04:59:59.999Z', '2026-03-08T05:00:00.000Z', '2026-03-08T06:59:59.999Z',
    '2026-03-08T07:00:00.000Z', '2026-03-09T03:59:59.999Z', '2026-03-09T04:00:00.000Z',
  ][i]; }));
  const value = f.service.day(owner, { date: '2026-03-08', timeZone: 'America/New_York' });
  assert.deepEqual(value.events.map(item => item.id), ['event-04', 'event-03', 'event-02', 'event-01']);
  assert.equal(value.total, 4);
});

test('fall DST display day retains both repeated 01:30 instants in chronological order', async () => {
  const f = await setup(6);
  await f.store.update(state => state.activity.forEach((item, i) => { item.at = [
    '2026-11-01T03:59:59.999Z', '2026-11-01T04:00:00.000Z', '2026-11-01T05:30:00.000Z',
    '2026-11-01T06:30:00.000Z', '2026-11-02T04:59:59.999Z', '2026-11-02T05:00:00.000Z',
  ][i]; }));
  const value = f.service.day(owner, { date: '2026-11-01', timeZone: 'America/New_York' });
  assert.deepEqual(value.events.map(item => item.id), ['event-04', 'event-03', 'event-02', 'event-01']);
  assert.equal(value.total, 4);
});

test('filter the entire authorized set before the six-mark cut; same-time ordering is deterministic', async () => {
  const f = await setup(10);
  await f.trust.grantSource(owner, { sourceId: 'source-9', memberIds: ['different-member'] });
  await f.trust.grantSource(owner, { sourceId: 'source-8', memberIds: ['different-member'] });
  await f.store.update(state => { state.activity = state.activity.filter(item => item.event === 'source.imported');
    state.activity.forEach(item => { item.at = '2026-10-04T10:00:00.000Z'; }); state.activity.reverse(); });
  const value = f.service.day(owner, request);
  assert.equal(value.total, 8); assert.equal(value.events.length, 6);
  assert.deepEqual(value.state, { kind: 'partial', reasonCodes: ['PROJECTION_CAPABILITY_PARTIAL'] });
  assert.deepEqual(value.events.map(item => item.id), ['event-00', 'event-01', 'event-02', 'event-03', 'event-04', 'event-05']);
  assert.deepEqual(f.service.resolveReference(owner, { ...request, eventId: 'event-07' }), {
    kind: 'import', importId: f.store.read().imports[7]!.id, sourceId: 'source-7',
  });
  assert.throws(() => f.service.resolveReference(owner, { ...request, eventId: 'event-09' }), { code: 'TODAY_EVENT_REFERENCE_UNAVAILABLE' });
});

test('unknown kinds and unresolved domain evidence differ from a complete authorized empty day', async () => {
  const f = await setup(0);
  assert.equal(f.service.day(owner, request).state.kind, 'complete');
  await f.store.update(state => { state.activity.push({ id: 'secret-event', at: '2026-10-04T10:00:00Z', event: 'secret.unknown.kind', details: { sourceId: 'SECRET SOURCE', error: 'SECRET ERROR' } }); });
  const unsupported = f.service.day(owner, request);
  assert.equal(unsupported.state.kind, 'partial'); assert.deepEqual(unsupported.state.reasonCodes, ['UNSUPPORTED_EVENT_KIND']);
  assert.equal(unsupported.total, 0); assert.deepEqual(unsupported.events, []);
  assert.doesNotMatch(JSON.stringify(unsupported), /secret|SECRET/);
  await f.store.update(state => { state.activity = [{ id: 'unresolved', at: '2026-10-04T10:00:00Z', event: 'source.imported', details: { sourceId: 'allowed', importId: 'missing', rowCount: 1 } }]; });
  const unresolved = f.service.day(owner, request);
  assert.equal(unresolved.state.kind, 'partial'); assert.deepEqual(unresolved.state.reasonCodes, ['EVENT_EVIDENCE_UNRESOLVED']);
  assert.equal(unresolved.total, 0);
});

test('resolver and display-rule omissions fail closed without invented data or timezone', async () => {
  const f = await setup();
  const noServices = new TodayEventsService({ store: f.store, rules: rules() }).day(owner, request);
  assert.equal(noServices.state.kind, 'unavailable'); assert.deepEqual(noServices.events, []);
  const noRules = new TodayEventsService({ store: f.store, services: { learning: f.learning } }).day(owner, request);
  assert.equal(noRules.calendarRevision, null); assert.equal(noRules.state.kind, 'unavailable'); assert.equal(noRules.total, 0);
  for (const invalid of [{ date: request.date }, { timeZone: request.timeZone }, { ...request, date: '2026-02-30' }, { ...request, timeZone: '+05:30' }, { ...request, limit: 6 }]) {
    assert.throws(() => f.service.day(owner, invalid as typeof request), { code: 'INVALID_TODAY_DAY' });
  }
  assert.throws(() => f.service.day(owner, { ...request, timeZone: 'Europe/London' }), { code: 'CALENDAR_ZONE_UNSUPPORTED' });
  assert.throws(() => new TodayEventsService({ store: f.store, services: { learning: new LearningService(new FixtureStateStore()) } }), { code: 'TODAY_AUTHORITY_STORE_MISMATCH' });
});

test('held read and event references reauthorize current source deletion and epoch revocation', async () => {
  const f = await setup(), held = f.service.day(owner, request);
  assert.equal(held.total, 1);
  assert.throws(() => f.service.release(owner, structuredClone(held)), { code: 'TODAY_HELD_RESULT_FORBIDDEN' });
  assert.throws(() => f.service.release({ ...owner, channel: 'phone' }, held), { code: 'TODAY_HELD_RESULT_FORBIDDEN' });
  await f.trust.deleteSource(owner, 'source-0');
  const released = f.service.release(owner, held);
  assert.equal(released.total, 0); assert.deepEqual(released.events, []); assert.equal(held.total, 1);
  assert.throws(() => f.service.resolveReference(owner, { ...request, eventId: 'event-00' }), { code: 'TODAY_EVENT_REFERENCE_UNAVAILABLE' });
  await f.store.update(state => { state.members[0]!.epoch += 1; });
  assert.throws(() => f.service.release(owner, held), { code: 'ACCESS_REVOKED' });
});

test('duplicate event IDs, invalid instants and audit operation tampering never release a reference', async () => {
  const f = await setup();
  await f.store.update(state => { state.activity.push(structuredClone(state.activity[0])); });
  const duplicate = f.service.day(owner, request);
  assert.equal(duplicate.state.kind, 'partial'); assert.equal(duplicate.total, 0);
  assert.throws(() => f.service.resolveReference(owner, { ...request, eventId: 'event-00' }), { code: 'TODAY_EVENT_REFERENCE_UNAVAILABLE' });
  await f.store.update(state => { state.activity = [state.activity[0]]; state.activity[0].at = '2026-02-30T00:00:00Z'; });
  assert.equal(f.service.day(owner, request).state.kind, 'partial');
  await f.store.update(state => { state.activity[0].at = '2026-10-04T10:00:00Z'; state.activity[0].details.rowCount = 100; });
  assert.equal(f.service.day(owner, request).total, 0);
  assert.deepEqual(f.service.day(owner, request).state.reasonCodes, ['EVENT_EVIDENCE_UNRESOLVED']);
});

test('source-restricted owners cannot learn unknown denied-source activity through diagnostics', async () => {
  const f = await setup();
  await f.trust.grantSource(owner, { sourceId: 'source-0', memberIds: ['different-member'] });
  await f.store.update(state => { state.activity = state.activity.filter(item => item.event === 'source.imported'); });
  const empty = f.service.day(owner, request);
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.state, { kind: 'partial', reasonCodes: ['PROJECTION_CAPABILITY_PARTIAL'] });
  await f.store.update(state => { state.activity.push({ id: 'private-denied-event', at: '2026-10-04T10:00:00Z', event: 'private.unknown.kind', details: { sourceId: 'source-0' } }); });
  assert.deepEqual(f.service.day(owner, request), empty);
  const unusual = await setup(0);
  await unusual.trust.grantSource(owner, { sourceId: 'valid real grant with spaces', memberIds: ['different-member'] });
  await unusual.store.update(state => { state.activity = []; });
  const unusualEmpty = unusual.service.day(owner, request);
  assert.deepEqual(unusualEmpty.state, empty.state);
  await unusual.store.update(state => { state.activity.push({ id: 'private-denied-event', at: '2026-10-04T10:00:00Z', event: 'private.unknown.kind', details: { sourceId: 'valid real grant with spaces' } }); });
  assert.deepEqual(unusual.service.day(owner, request), unusualEmpty);
});
