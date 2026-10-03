import test from 'node:test';
import assert from 'node:assert/strict';
import { projectFigureForUi, projectMetadataCountForUi, projectRowForUi, projectChartForUi, projectTodayForUi } from '../src/bridge/project-ui.ts';
import type { UIFormatContext } from '../src/bridge/project-ui.ts';
import { ReplyValidationError } from '../src/bridge/validate.ts';
import { chartFixture, moneyFigure, rowFixture, todayFixture, HUGE_INTEGER } from './fixtures.ts';

const config: UIFormatContext = {
  language: 'en', timeZone: 'Asia/Kolkata',
  missingWords: { absent: 'Absent', null: 'Not recorded', unknown: 'Not known', withheld: 'Withheld', 'not-applicable': 'Not applicable', 'not-loaded-yet': 'Not loaded yet', 'not-counted': 'Not counted' },
};

test('known UI figures retain exact strings, receipt identities and every supplied label', () => {
  const known = projectFigureForUi({ ...moneyFigure(HUGE_INTEGER), labels: ['projection', 'stale'] }, config);
  assert.equal(known.kind, 'money');
  assert.equal(known.exact, HUGE_INTEGER); assert.equal(known.receiptId, 'receipt_fixture');
  assert.deepEqual(known.labels, ['projection', 'stale']); assert.equal(typeof known.display, 'string');
  assert.equal(Object.isFrozen(known), true); assert.equal(Object.isFrozen(known.labels), true);
  assert.deepEqual(projectFigureForUi({ kind: 'percent', basisPoints: '3140', receiptId: 'ratio_receipt', labels: [] }, config), { kind: 'percent', exact: '3140', display: '31.4%', spoken: '31.4%', receiptId: 'ratio_receipt', labels: [] });
  assert.throws(() => projectFigureForUi({ kind: 'money', paise: 1, currency: 'INR', receiptId: 'receipt_fixture', labels: [] }, config), ReplyValidationError);
});

test('missing figures and metadata counts remain distinct from known business zero', () => {
  assert.deepEqual(projectFigureForUi({ kind: 'missing', state: 'not-loaded-yet' }, config), { kind: 'missing', missing: 'not-loaded-yet' });
  assert.deepEqual(projectMetadataCountForUi(null, config), { exact: null, display: 'Not known' });
  assert.deepEqual(projectMetadataCountForUi('0', config), { exact: '0', display: '0' });
  assert.equal(projectMetadataCountForUi(HUGE_INTEGER, config).exact, HUGE_INTEGER);
  assert.throws(() => projectMetadataCountForUi(4 as unknown as string, config), ReplyValidationError);
  const zero = projectFigureForUi(moneyFigure('0'), config);
  assert.equal(zero.kind, 'money'); assert.equal(zero.display, '\u20b90');
});

test('row text remains as written and only a supplied sheet intent offers Open', () => {
  const row = rowFixture();
  const result = projectRowForUi({ ...row, title: '<script>Fixture text only</script>', note: 'दर्ज पाठ' }, config);
  assert.equal(result.row.what, '<script>Fixture text only</script>'); assert.equal(result.row.note, 'दर्ज पाठ');
  assert.deepEqual(result.action, row.action); assert.deepEqual(result.row.can, ['open']);
  const noOffer = projectRowForUi({ id: 'readonly_row', title: 'View text', note: '', mark: 'off' }, config);
  assert.equal(Object.hasOwn(noOffer.row, 'can'), false); assert.equal(Object.hasOwn(noOffer, 'action'), false);
  assert.equal(Object.hasOwn(result.row, 'owner'), false); assert.equal(Object.hasOwn(result.row, 'detail'), false);
});

test('row and day action maps retain actual engine opaque identities and guess values fail before display', () => {
  const row = { ...rowFixture(), action: { type: 'open-sheet' as const, address: '#/work/approvals?sheet=action_01234567-89ab-cdef-0123-456789abcdef' } };
  const event = { ...todayFixture().dayEvents[0]!, action: { type: 'open-sheet' as const, address: '#/trust/receipts?sheet=receipt_01234567-89ab-cdef-0123-456789abcdef' } };
  const today = projectTodayForUi({ ...todayFixture(), attention: [row], dayEvents: [event] }, config);
  assert.deepEqual(today.rowActions, [{ rowId: row.id, intent: row.action }]);
  assert.deepEqual(today.dayActions, [{ eventId: event.id, intent: event.action }]);
  assert.throws(() => projectRowForUi({ ...row, mark: 'guess' }, config), ReplyValidationError);
  assert.throws(() => projectTodayForUi({ ...todayFixture(), attention: [{ ...row, mark: 'guess' }] }, config), ReplyValidationError);
  assert.deepEqual(projectRowForUi({ ...row, mark: 'guess', figure: { kind: 'missing', state: 'not-applicable' } }, config).row.figure, { kind: 'missing', missing: 'not-applicable' });
});

test('three supported chart forms preserve gaps, exact figures, receipt references and supplied labels', () => {
  for (const kind of ['line', 'columns', 'ordered-bar'] as const) {
    const chart = { ...chartFixture(), kind };
    const projected = projectChartForUi(chart, config);
    assert.equal(projected.state, 'available'); if (projected.state !== 'available') assert.fail('Missing supported form');
    assert.equal(projected.chart.form, kind); assert.equal(projected.chart.sentence, chart.description);
    assert.equal(projected.chart.values.length, 3); assert.deepEqual(projected.chart.values[1]?.value, { kind: 'missing', missing: 'unknown' });
    const last = projected.chart.values[2]!.value;
    if (last.kind === 'missing') assert.fail('Lost exact figure');
    assert.equal(last.exact, HUGE_INTEGER); assert.equal(last.receiptId, 'receipt_fixture');
    if (projected.chart.form === 'line') { assert.equal(projected.chart.from, 'August'); assert.equal(projected.chart.to, 'October'); }
    assert.equal(Object.hasOwn(projected.chart.values[2]!, 'emphasis'), false);
  }
});

test('missing and unsupported charts are explicit states, never synthetic plots', () => {
  assert.deepEqual(projectChartForUi(null, config), { state: 'missing', reasonCode: 'CHART_NOT_PROVIDED' });
  assert.deepEqual(projectChartForUi({ ...chartFixture(), kind: 'bridge' }, config), { state: 'missing', reasonCode: 'CHART_FORM_NOT_IMPLEMENTED' });
  assert.deepEqual(projectChartForUi({ ...chartFixture(), points: [] }, config), { state: 'missing', reasonCode: 'CHART_HAS_NO_POINTS' });
  assert.deepEqual(projectChartForUi({ ...chartFixture(), points: [{ id: 'unknown_month', label: 'September', value: { kind: 'missing', state: 'unknown' } }] }, config), { state: 'missing', reasonCode: 'CHART_HAS_NO_KNOWN_POINTS' });
  assert.throws(() => projectChartForUi({ ...chartFixture(), points: [{ id: 'broken', label: 'Bad', value: { kind: 'money', paise: '10', currency: 'INR', labels: [] } }] }, config), ReplyValidationError);
});

test('Today projection preserves neutral state, source dates and action intents without inventing scope', () => {
  const fixture = todayFixture();
  const projected = projectTodayForUi(fixture, config);
  assert.equal(projected.title, fixture.title); assert.equal(projected.data.date, 'Thursday, 1 October');
  assert.deepEqual(projected.data.state, { kind: 'boundary-state', source: fixture.state });
  assert.deepEqual(projected.data.review.count, { exact: null, display: 'Not known' });
  assert.equal(projected.data.earlierToday[0]?.time, '14:30');
  assert.equal(Object.hasOwn(projected.data.earlierToday[0]!, 'figure'), false);
  assert.equal(Object.hasOwn(projected.data.earlierToday[0]!, 'receiptId'), false);
  assert.equal(Object.hasOwn(projected.data, 'enterprise'), false); assert.equal(Object.hasOwn(projected.data, 'cash'), false);
  assert.equal(Object.hasOwn(projected.data, 'queue'), false); assert.equal(Object.hasOwn(projected.data, 'close'), false);
  assert.deepEqual(projected.rowActions, [{ rowId: fixture.attention[0]!.id, intent: fixture.attention[0]!.action }]);
  assert.deepEqual(projected.chartStates, [{ statId: 'margin', state: { state: 'missing', reasonCode: 'CHART_NOT_PROVIDED' } }]);
  assert.deepEqual(projected.data.thisMonth[0]?.chartState, { state: 'missing', reasonCode: 'CHART_NOT_PROVIDED' });
  assert.equal(Object.isFrozen(projected.data.review.rows), true);
});

test('Today change figures are receipted and layout overflow is refused without dropping data', () => {
  const base = todayFixture();
  const stats = Array.from({ length: 4 }, (_, i) => ({ id: `stat_${i}`, label: 'Fixture', figure: moneyFigure('0'), change: { kind: 'percent' as const, basisPoints: '-1800', receiptId: 'change_receipt', labels: [] }, changeLabel: 'down', chart: chartFixture() }));
  assert.throws(() => projectTodayForUi({ ...base, stats }, config), ReplyValidationError);
  const explicitWide = projectTodayForUi({ ...base, stats }, { ...config, maxStats: 4 });
  assert.equal(explicitWide.data.thisMonth.length, 4); assert.equal(explicitWide.data.thisMonth[0]?.changeLabel, 'down');
  assert.deepEqual(explicitWide.data.thisMonth[0]?.chartState, { state: 'available' });
  const change = explicitWide.data.thisMonth[0]!.change!; if (change.kind === 'missing') assert.fail('Lost change');
  assert.equal(change.receiptId, 'change_receipt'); assert.equal(change.exact, '-1800'); assert.equal(change.display, '-18%');
  const empty = projectTodayForUi({ ...base, stats: [], state: { kind: 'ready' } }, config);
  assert.deepEqual(empty.data.state, { kind: 'ready' }); assert.equal(empty.data.thisMonthMissing, 'unknown');
});

test('locked projections cannot carry cached workspace evidence or action intents', () => {
  assert.throws(() => projectTodayForUi({ ...todayFixture(), state: { kind: 'locked', reasonCode: 'VAULT_LOCKED' } }, config), ReplyValidationError);
  const safe = projectTodayForUi({ ...todayFixture(), attention: [], worthLook: [], stats: [], dayEvents: [], pendingCount: null, state: { kind: 'locked', reasonCode: 'VAULT_LOCKED' } }, config);
  assert.deepEqual(safe.data.state, { kind: 'boundary-state', source: { kind: 'locked', reasonCode: 'VAULT_LOCKED' } });
  assert.deepEqual(safe.data.review.rows, []); assert.equal(safe.data.review.count.exact, null);
  assert.deepEqual(safe.data.worthALook, []); assert.deepEqual(safe.data.thisMonth, []); assert.deepEqual(safe.data.earlierToday, []);
  assert.deepEqual(safe.rowActions, []); assert.deepEqual(safe.dayActions, []); assert.deepEqual(safe.chartStates, []);
});

test('invalid timezone/config and corrupt Today fail before partial display data is returned', () => {
  assert.throws(() => projectTodayForUi(todayFixture(), { ...config, timeZone: 'private invalid zone' }), ReplyValidationError);
  assert.throws(() => projectTodayForUi({ ...todayFixture(), pendingCount: 0 }, config), ReplyValidationError);
  assert.throws(() => projectTodayForUi({ ...todayFixture(), stats: [{ id: 's', label: 'Fixture', figure: moneyFigure('0'), changeLabel: 'down 18%', chart: null }] }, config), ReplyValidationError);
});
