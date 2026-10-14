import { useRef, useState, type ReactElement } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { createHash, webcrypto } from 'node:crypto';
import { engine as frozenFirstRunEngine, nodeDigest } from '../../app/ui/tests/first-run/fixture';
import userEvent from '@testing-library/user-event';
import { AskLine, useVoiceHold, type AskLineProps } from '../../app/ui/src/app/AskLine';
import { TextProvider } from '../../app/ui/src/app/text';
import { Sheet } from '../../app/ui/src/parts/Sheet';
import { TodayScreen } from '../../app/ui/src/screens/today/Today';
import type { TodayData, TodayIntents } from '../../app/ui/src/screens/today/TodayData';
import { ConversationAnswer } from '../../app/ui/src/screens/ask/ConversationAnswer';
import { validateConversationReadback } from '../../app/ui/src/bridge/conversation-contract';
import { fullCalculationReceiptFixture } from '../../app/ui/tests/fixtures';
import { readbackFixture } from '../../app/ui/tests/conversation-fixtures';
import { createHostController } from '../../app/ui/src/host/controller';
import { mountHost } from '../../app/ui/src/host/bootstrap';
import type { HostRpcPayloads, HostRpcPort, UiContext } from '../../app/ui/src/host/contracts';
import type { EngineTodayResponse, TodayAttention, TodayConfiguration, TodayDayEvent, TodayPreparedTiles, TodayProducerInput, TodayReviewQueue, TodayReviewRow, TodayTileValue } from '../../app/ui/src/bridge/today-engine';
import en from '../../app/ui/src/text/en.json';
import hi from '../../app/ui/src/text/hi.json';

// All figures and checked replies are synthetic. Components have no live bridge.
function show(ui: ReactElement) {
  return render(<TextProvider language="en">{ui}</TextProvider>);
}

function todayData(): TodayData {
  return {
    state: { kind: 'ready' },
    date: 'Synthetic fixture · 1 October',
    review: {
      count: { exact: '2', display: '2' },
      rows: [
        {
          id: 'row-a', mark: 'you', what: 'Fixture review A', detail: 'Synthetic A detail', can: ['review'],
          figure: { kind: 'money', exact: '900', display: 'INR 9.00', receiptId: 'receipt-a', labels: [] },
        },
        {
          id: 'row-b', mark: 'you', what: 'Fixture review B', detail: 'Synthetic B detail', can: ['review'],
          figure: { kind: 'money', exact: '275', display: 'INR 2.75', receiptId: 'receipt-b', labels: [] },
        },
      ],
    },
  };
}

function ask(props: AskLineProps) {
  return show(<AskHarness {...props} />);
}

function AskHarness(props: AskLineProps) {
  const hold = useVoiceHold(props.voice);
  return <AskLine {...props} hold={hold} />;
}

function SheetHarness() {
  const origin = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" ref={origin} onClick={() => setOpen(true)}>Open fixture receipt</button>
      {open && (
        <Sheet kind="Receipt" title="Synthetic receipt detail" origin={origin.current} onClose={() => setOpen(false)}>
          <p>Checked fixture evidence</p>
        </Sheet>
      )}
    </>
  );
}

beforeEach(() => {
  // Fail locally if any component tries a network fetch. jsdom loads no remote assets.
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network is unavailable in this fixture suite'));
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
  vi.stubGlobal('crypto', webcrypto);
});

afterEach(async () => {
  await act(async () => { for (const dispose of todayDisposals.splice(0)) dispose(); });
  cleanup();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  document.body.replaceChildren(); window.location.hash = '';
  vi.unstubAllGlobals();
});

test('Today keyboard movement keeps receipt activation separate from opening and reviewing its row', async () => {
  const user = userEvent.setup();
  const onReview = vi.fn<TodayIntents['onReview']>();
  const onReceipt = vi.fn<TodayIntents['onReceipt']>();
  show(<TodayScreen data={todayData()} intents={{ onReview, onReceipt }} view="guided" onNavigate={vi.fn()} />);
  const a = screen.getByRole('button', { name: /Fixture review A/ });
  const b = screen.getByRole('button', { name: /Fixture review B/ });
  const receipt = screen.getByRole('button', { name: 'INR 2.75' });

  a.focus();
  await user.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(b);
  expect(b.tabIndex).toBe(0);
  expect(a.tabIndex).toBe(-1);
  await user.keyboard('{ArrowRight}{Enter}');
  expect(document.activeElement).toBe(receipt);
  expect(onReceipt).toHaveBeenCalledExactlyOnceWith('receipt-b');
  expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
  expect(onReview).not.toHaveBeenCalled();

  await user.keyboard('{ArrowLeft}{Enter}');
  expect(document.activeElement).toBe(b);
  await user.click(screen.getByRole('button', { name: 'Review' }));
  expect(onReview).toHaveBeenCalledExactlyOnceWith('row-b', b);
  expect(onReceipt).toHaveBeenCalledTimes(1);
});

test('opening a sheet focuses its title and closing returns to the actual originating control', async () => {
  const user = userEvent.setup();
  show(<SheetHarness />);
  const origin = screen.getByRole('button', { name: 'Open fixture receipt' });
  origin.focus();
  await user.keyboard('{Enter}');
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Synthetic receipt detail' }));
  await user.click(screen.getByRole('button', { name: /^Close/ }));
  expect(screen.queryByRole('heading', { name: 'Synthetic receipt detail' })).toBeNull();
  expect(document.activeElement).toBe(origin);
});

test('read-only Today removes cash, prepare, setup and update mutations while receipts remain readable', async () => {
  const user = userEvent.setup();
  const base = todayData();
  const onPrepare = vi.fn<NonNullable<TodayIntents['onPrepare']>>();
  const onSaveClosing = vi.fn<NonNullable<TodayIntents['onSaveClosing']>>();
  const onResumeSetup = vi.fn<NonNullable<TodayIntents['onResumeSetup']>>();
  const onUpdate = vi.fn<NonNullable<TodayIntents['onUpdate']>>();
  const onReceipt = vi.fn<TodayIntents['onReceipt']>();
  const data: TodayData = {
    ...base,
    state: { kind: 'read-only', holder: 'Fixture owner' },
    review: { rows: [{ id: 'prepare-row', mark: 'you', what: 'Fixture prepare', detail: 'Synthetic detail', can: ['prepare'] }] },
    setup: { step: '1', of: '2', can: ['continue'] },
    update: { can: ['update'] },
    cash: {
      entered: { kind: 'money', exact: '900', display: 'INR 9.00', receiptId: 'receipt-cash', labels: [] },
      week: { form: 'columns', sentence: 'Synthetic chart with no supplied points', values: [] },
    },
  };
  const intents = { onReview: vi.fn(), onPrepare, onSaveClosing, onResumeSetup, onUpdate, onReceipt };
  const { rerender } = show(<TodayScreen data={data} intents={intents} view="simple" onNavigate={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /Fixture prepare/ }));
  expect(screen.queryByRole('button', { name: 'Prepare' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: "Today's cash sales" })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'INR 9.00' }));
  expect(onReceipt).toHaveBeenCalledExactlyOnceWith('receipt-cash');
  const unentered: TodayData = {
    ...data, cash: { week: { form: 'columns', sentence: 'Synthetic chart with no supplied points', values: [] } },
  };
  rerender(<TextProvider language="en"><TodayScreen data={unentered} intents={intents} view="simple" onNavigate={vi.fn()} /></TextProvider>);
  expect(screen.queryByRole('textbox', { name: "Today's cash sales" })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Enter' })).toBeNull();
  for (const callback of [onPrepare, onSaveClosing, onResumeSetup, onUpdate]) expect(callback).not.toHaveBeenCalled();
});

test('Simple Today submits a cash string once without numeric conversion, then clears the field', async () => {
  const user = userEvent.setup();
  const onSaveClosing = vi.fn<NonNullable<TodayIntents['onSaveClosing']>>();
  const data: TodayData = {
    ...todayData(),
    cash: { week: { form: 'columns', sentence: 'Synthetic chart with no supplied points', values: [] } },
  };
  show(<TodayScreen data={data} intents={{ onReview: vi.fn(), onReceipt: vi.fn(), onSaveClosing }} view="simple" onNavigate={vi.fn()} />);
  const field = screen.getByRole('textbox', { name: "Today's cash sales" });
  if (!(field instanceof HTMLInputElement)) throw new Error('Cash field must be an input');
  await user.type(field, '00,450.70');
  expect(onSaveClosing).not.toHaveBeenCalled();
  await user.keyboard('{Enter}');
  expect(onSaveClosing).toHaveBeenCalledExactlyOnceWith('00,450.70');
  expect(field.value).toBe('');
});

test('Ask preserves reviewed question text, submits only on Enter and has no absent voice control', async () => {
  const user = userEvent.setup();
  const onAsk = vi.fn<AskLineProps['onAsk']>();
  ask({ onAsk });
  const field = screen.getByRole('textbox', { name: 'Ask a question, or give a task' });
  if (!(field instanceof HTMLInputElement)) throw new Error('Ask field must be an input');
  const question = '  Show the fixture receipts?  ';
  await user.type(field, question);
  expect(onAsk).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /talk|voice/i })).toBeNull();
  await user.keyboard('{Enter}');
  expect(onAsk).toHaveBeenCalledExactlyOnceWith(question);
  expect(field.value).toBe('');
  await user.type(field, '   {Enter}');
  expect(onAsk).toHaveBeenCalledTimes(1);
});

test('an explicitly off microphone opens settings without starting or ending a voice hold', async () => {
  const user = userEvent.setup();
  const onHoldStart = vi.fn();
  const onHoldEnd = vi.fn();
  const onOpenSettings = vi.fn();
  const onAsk = vi.fn();
  ask({ onAsk, voice: { on: false, onHoldStart, onHoldEnd, onOpenSettings } });
  await user.click(screen.getByRole('button', { name: /^Voice is off/ }));
  expect(onOpenSettings).toHaveBeenCalledTimes(1);
  expect(onHoldStart).not.toHaveBeenCalled();
  expect(onHoldEnd).not.toHaveBeenCalled();
  expect(onAsk).not.toHaveBeenCalled();
});

test('checked calculation figures retain engine display strings and open only the calculation receipt', async () => {
  const user = userEvent.setup();
  const receipt = fullCalculationReceiptFixture();
  const wire = readbackFixture(receipt);
  const saved = validateConversationReadback(wire, wire.id);
  const onReference = vi.fn();
  const onContinue = vi.fn();
  const onPreviewFinalWriting = vi.fn();
  const { container } = show(<ConversationAnswer saved={saved} onReference={onReference} onContinue={onContinue} onPreviewFinalWriting={onPreviewFinalWriting} />);
  for (const figure of receipt.figures) {
    const control = screen.getByRole('button', { name: new RegExp(`^${figure.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[,: ]`) });
    expect(control.textContent).toBe(figure.display);
  }
  await user.click(screen.getByRole('button', { name: /^Earned[,: ]/ }));
  expect(onReference).toHaveBeenCalledExactlyOnceWith({ kind: 'calculation-receipt', id: receipt.id });
  expect(screen.queryByRole('button', { name: 'Answer this' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Preview writing' })).toBeNull();
  const details = Array.from(container.querySelectorAll('details'));
  expect(details.length).toBeGreaterThan(0);
  expect(details.every(detail => !detail.open)).toBe(true);
  expect(onContinue).not.toHaveBeenCalled();
  expect(onPreviewFinalWriting).not.toHaveBeenCalled();
});

test('checked partial coverage with no counted rows shows unknown and never renders supplied figure values', () => {
  const receipt = fullCalculationReceiptFixture();
  const partial = {
    ...receipt, rows: [], rowIds: [],
    coverage: { ...receipt.coverage, selectedRows: 0, countedRows: 0, completeness: 'partial' },
  };
  const question = '<img src="fixture" onerror="fixtureSecret()">';
  const wire = readbackFixture(partial, question);
  const saved = validateConversationReadback(wire, wire.id);
  const { container } = show(<ConversationAnswer saved={saved} onReference={vi.fn()} />);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(question);
  expect(container.querySelector('img, script')).toBeNull();
  expect(screen.getAllByText('not sure').length).toBeGreaterThan(0);
  for (const figure of receipt.figures) {
    expect(screen.queryByRole('button', { name: new RegExp(`^${figure.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[,: ]`) })).toBeNull();
  }
});

test('clarification continuation passes the saved id and preserves model receipt identity', async () => {
  const user = userEvent.setup();
  const wire = readbackFixture({ clarification: 'Which fixture period?', modelReceiptId: 'model_preview_fixture' });
  const saved = validateConversationReadback(wire, wire.id);
  const onContinue = vi.fn();
  const onReference = vi.fn();
  show(<ConversationAnswer saved={saved} onContinue={onContinue} onReference={onReference} />);
  await user.click(screen.getByRole('button', { name: 'Answer this' }));
  expect(onContinue).toHaveBeenCalledExactlyOnceWith(saved.id);
  await user.click(screen.getByRole('button', { name: 'model_preview_fixture' }));
  expect(onReference).toHaveBeenCalledExactlyOnceWith({ kind: 'model-receipt', id: 'model_preview_fixture' });
});

// Mounted host journeys use only synthetic producer-shaped replies. They qualify React
// composition and dispatch guards, not native authorities, pixels or Hindi typography.
const todayDisposals: (() => void)[] = [];
const TODAY_AT = '2026-10-04T07:00:00.000Z';
const DISPLAY = { date: '2026-10-04', timeZone: 'Asia/Kolkata' };
const CONTEXT: UiContext = {
  workspace: { id: 'workspace_fixture', name: 'Synthetic Today workspace', demo: true },
  member: { id: 'member_fixture', name: 'Synthetic owner', role: 'owner', epoch: 7, branches: ['North office'] },
  contextKey: 'a'.repeat(64),
};
const SAFE_TEXT = '<img src="fixture" onerror="fixtureSecret()"> Hindi \u0930\u0938\u0940\u0926';
const messages = (language: 'en' | 'hi'): Readonly<Record<string, string>> => language === 'hi' ? hi : en;
const words = (key: string, language: 'en' | 'hi' = 'en') => {
  const value = messages(language)[key]; if (value === undefined) throw Error(`Missing fixture catalogue key ${key}`); return value;
};
function nativeButton(name: string | RegExp, scope: Pick<typeof screen, 'getByRole'> = screen): HTMLButtonElement {
  const value = scope.getByRole('button', { name });
  if (!(value instanceof HTMLButtonElement)) throw Error('Expected a native fixture control'); return value;
}
function currentSheet() {
  const value = document.querySelector('[data-region="sheet"]');
  if (!(value instanceof HTMLElement)) throw Error('Expected the one current Today sheet'); return within(value);
}
const sheetCount = () => document.querySelectorAll('[data-region="sheet"]').length;
const settleToday = async () => { await act(async () => { for (let index = 0; index < 16; index++) await Promise.resolve(); }); };
function deferredToday<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject };
}
function recordedGroup(name: string, scope: ReturnType<typeof within> = currentSheet()) {
  const field = scope.getByText(name, { selector: 'dt' }).nextElementSibling;
  if (!(field instanceof HTMLElement) || field.tagName !== 'DD') throw Error(`Missing recorded fixture group ${name}`);
  return within(field);
}
function assertCapturedEvent(event: TodayDayEvent, language: 'en' | 'hi') {
  const captured = recordedGroup('event'), args = recordedGroup('args', captured), actor = recordedGroup('actor', captured);
  expect(captured.getByText(event.id)).toBeTruthy(); expect(captured.getByText(event.kind)).toBeTruthy();
  expect(captured.getByText(event.at)).toBeTruthy();
  expect(actor.getByText(event.actor.kind)).toBeTruthy();
  if (event.actor.kind === 'member') expect(actor.getByText(event.actor.memberId)).toBeTruthy();
  for (const [name, value] of Object.entries(event.args)) {
    const field = args.getByText(name, { selector: 'dt' }).nextElementSibling;
    expect(field?.textContent).toBe(value === null ? words('MISSING.unknown', language) : String(value));
  }
}

function explicitConfiguration(): TodayConfiguration {
  const period = { from: '2026-09-01', to: '2026-09-30' };
  const request: TodayConfiguration['request'] = {
    dictionaryHash: 'c'.repeat(64), asOf: TODAY_AT,
    scope: { sourceIds: ['source_orders', 'source_costs'], branch: 'North office' },
    tiles: [
      { id: 'earned', label: 'Producer earned', operation: 'earned', figureKey: 'total', period, buckets: [
        { id: 'known', label: 'Producer known bucket', period: { from: '2026-09-01', to: '2026-09-14' } },
        { id: 'unknown', label: 'Producer missing bucket', period: { from: '2026-09-15', to: '2026-09-30' } },
      ], comparison: { operation: 'changeEarned', figureKey: 'change', period: { from: '2026-08-01', to: '2026-08-31' } } },
      { id: 'contribution', label: 'Producer contribution', operation: 'margin', figureKey: 'contribution', period, buckets: [] },
      { id: 'margin', label: 'Producer margin', operation: 'margin', figureKey: 'marginBps', period, buckets: [] },
    ],
  };
  return { configurationId: 'configuration_fixture', configurationDigest: createHash('sha256').update(JSON.stringify(request)).digest('hex'), starterPack: { id: 'Explicit fixture pack', dictionaryHash: request.dictionaryHash, version: 4 }, request };
}
function measuredValue(operation: string, figureKey: string, receiptId: string, display: string, minor = '900719925474099312345678901234567890', unit: 'money' | 'basis-points' = 'money'): TodayTileValue {
  return {
    status: 'partial', figure: { key: figureKey, label: 'Producer exact figure', minor, display, unit, ...(unit === 'money' ? { currency: 'INR' } : {}) }, receiptId,
    definition: { dictionaryHash: 'c'.repeat(64), ontologyVersion: 4, definitionHash: 'd'.repeat(64), definitions: [{ name: operation, label: 'Producer meaning', meaning: 'Only released source rows count.', kind: 'order', field: 'amountMinor', currency: 'INR', nulls: 'reject' }], operationId: operation, operationType: operation === 'margin' ? 'margin' : operation === 'changeEarned' ? 'change' : 'sum' },
    coverage: { selectedRows: 3, countedRows: 1, excludedRows: 2, unresolvedConflicts: 1, importIds: ['import_fixture'], completeness: 'partial', gaps: ['Producer source coverage is incomplete.'] },
    gaps: [{ code: 'SOURCE_PARTIAL', message: 'Producer has not released all rows.' }],
  };
}
function preparedFigures(configuration: TodayConfiguration): TodayPreparedTiles {
  return {
    reference: { id: 'capture_fixture', digest: 'e'.repeat(64) }, display: { ...DISPLAY },
    configuration: { id: configuration.configurationId, digest: configuration.configurationDigest, starterPack: { ...configuration.starterPack }, origin: 'custom' },
    result: { version: 1, asOf: configuration.request.asOf, dictionary: { hash: configuration.starterPack.dictionaryHash, version: 4 }, scope: structuredClone(configuration.request.scope), atomic: false, verification: 'not-configured', tiles: configuration.request.tiles.map(tile => ({
      id: tile.id, label: tile.label, operation: tile.operation, figureKey: tile.figureKey, period: { ...tile.period },
      value: measuredValue(tile.operation, tile.figureKey, `receipt_${tile.id}`, tile.id === 'margin' ? 'Producer exact 19.37%' : `Producer exact ${tile.id} huge amount`, tile.id === 'margin' ? '1937' : undefined, tile.id === 'margin' ? 'basis-points' : 'money'),
      points: tile.buckets.map((bucket, index) => ({ ...structuredClone(bucket), value: index === 0 ? measuredValue(tile.operation, tile.figureKey, 'receipt_bucket', 'Producer bucket amount as written') : { status: 'unavailable', figure: null, receiptId: null, definition: null, coverage: null, gaps: [{ code: 'BUCKET_UNAVAILABLE', message: 'No released bucket evidence.' }] } })),
      ...(tile.comparison ? { comparison: { ...structuredClone(tile.comparison), value: measuredValue(tile.comparison.operation, tile.comparison.figureKey, 'receipt_comparison', 'Producer comparison decrease as written', '-1703') } } : {}),
    })) },
  };
}
function actionReview(id = 'action_fixture', revision = 3): TodayReviewRow {
  return { kind: 'action-approval', title: `Producer review ${id}`, since: TODAY_AT, reference: { kind: 'action-approval', id, revision, digest: '1'.repeat(64) }, request: { method: 'actions.approve', payload: { id, digest: '1'.repeat(64) } }, canApprove: true, provenance: [{ producer: 'actions', id, revision, digest: '1'.repeat(64) }] };
}
function reviewQueue(rows = [actionReview()], nextCursor: string | null = 'eyJvcGFxdWUiOiJmaXh0dXJlLXNlYWwifQ'): TodayReviewQueue {
  return { scope: 'prepared-actions-job-mandates-deliverables-lessons-v1', completeness: 'complete', count: 6, knownCount: 6, rows, nextCursor, producers: { actions: { status: 'complete' }, jobs: { status: 'complete' }, lessons: { status: 'complete' } } };
}
function retainedAttention(): TodayAttention {
  return {
    kind: 'today-attention-v1', request: { displayedDate: DISPLAY.date, timeZone: DISPLAY.timeZone, branch: 'North office' },
    authority: { workspaceId: CONTEXT.workspace.id, memberId: CONTEXT.member.id, epoch: CONTEXT.member.epoch, stateRevision: 19 },
    alertEpisodes: [], dueDecisions: [{ reference: { kind: 'decision', decisionId: 'decision_due' }, text: SAFE_TEXT, reviewDate: DISPLAY.date, due: 'today', status: 'open', branch: 'North office', revision: null, receiptIds: ['receipt_decision'] }],
    calendar: { window: { from: DISPLAY.date, through: '2026-10-10', days: 7, timeZone: DISPLAY.timeZone }, state: 'unavailable', reason: 'no-reviewed-calendar', rows: [] },
    counts: { alertEpisodes: 0, dueDecisions: 1, calendarEntries: 0 }, alertsCheckedAt: TODAY_AT, evaluated: false, pin: 'f'.repeat(64),
  };
}
function sixEvents(): TodayDayEvent[] {
  const base = { at: TODAY_AT, actor: { kind: 'not-recorded' as const } };
  return [
    { ...base, id: 'event_created', kind: 'decision.created', args: {}, reference: { kind: 'decision', decisionId: 'decision_created' } },
    { ...base, id: 'event_revised', kind: 'decision.revised', args: { revision: 2 }, reference: { kind: 'decision', decisionId: 'decision_revised' } },
    { ...base, id: 'event_reviewed', kind: 'decision.reviewed', args: { outcome: 'continue', revision: 2 }, reference: { kind: 'decision', decisionId: 'decision_reviewed' } },
    { ...base, id: 'event_prepared', kind: 'action.prepared', args: { connector: 'connector_fixture', operation: 'operation_fixture' }, reference: { kind: 'action', actionId: 'action_prepared' } },
    { ...base, id: 'event_settled', kind: 'action.settled', args: { connector: 'connector_fixture', operation: 'operation_fixture', outcome: 'unknown', businessSuccess: null }, reference: { kind: 'action', actionId: 'action_settled' } },
    { ...base, id: 'event_interrupted', kind: 'action.interrupted', args: { connector: 'connector_fixture', operation: 'operation_fixture', outcome: 'blocked' }, reference: { kind: 'action', actionId: 'action_interrupted' } },
  ];
}
function engineToday(): EngineTodayResponse {
  const attention = retainedAttention();
  return {
    kind: 'today-engine-v1', display: { ...DISPLAY }, atomic: false, noAction: true, starterPack: { ...explicitConfiguration().starterPack },
    defaults: { state: 'unconfigured', reason: 'pack-defaults-not-configured' }, state: { kind: 'partial', asOf: null, reasonCode: 'TODAY_ENGINE_CONTRACT_PARTIAL' }, productReviewCount: null,
    tiles: { state: 'unavailable', reason: 'capture-required' }, review: { state: 'available', value: reviewQueue() },
    attention: { state: 'available', value: attention, selection: { state: 'configured', policyId: 'Explicit fixture selection', policyRevision: 'revision_fixture', eligibleCount: 1, rows: [{ id: 'selected_due', kind: 'due-decision', value: attention.dueDecisions[0]! }] } },
    dayEvents: { state: 'available', value: { ...DISPLAY, calendarRevision: null, events: sixEvents(), total: 9, state: { kind: 'partial', reasonCodes: ['ACTOR_NOT_RECORDED', 'PROJECTION_CAPABILITY_PARTIAL'] } } },
  };
}
function currentAction(id = 'action_fixture', revision = 3) {
  return { id, connector: 'connector_fixture', operation: 'operation_fixture', payload: { text: SAFE_TEXT }, sourceIds: ['source_orders'], idempotencyKey: `fixture-${id}`, digest: '1'.repeat(64), revision, createdBy: CONTEXT.member.id, createdEpoch: CONTEXT.member.epoch, createdAt: TODAY_AT, impact: 'message', status: 'prepared', attempts: [] };
}
function todayTransport() {
  const calls: { method: keyof HostRpcPayloads; payload: unknown }[] = [];
  const behavior = new Map<keyof HostRpcPayloads, (payload: unknown) => unknown | Promise<unknown>>();
  const contexts: ReturnType<typeof deferredToday<unknown>>[] = [];
  const configuration = explicitConfiguration(), prepared = preparedFigures(configuration);
  const port: HostRpcPort = { async request(method, payload) {
    calls.push({ method, payload: structuredClone(payload) });
    if (method === 'ui.context') return contexts.shift()?.promise ?? structuredClone(CONTEXT);
    const override = behavior.get(method); if (override) return override(payload);
    if (method === 'ontology.get') {
      const frozen = await frozenFirstRunEngine(), current = frozen.compile(frozen.pack(0), 1, 'member_fixture', TODAY_AT);
      return { current, history: [current] };
    }
    if (method === 'models.list') return [];
    if (method === 'today.get') return { ...engineToday(), ...('tileCapture' in payload ? { tiles: { state: 'prepared', value: prepared } } : {}) };
    if (method === 'today.prepareTiles') return prepared;
    if (method === 'today.review') return reviewQueue('cursor' in payload ? [actionReview('action_next', 4)] : [actionReview()]);
    if (method === 'today.resolveReview') {
      if (!('reference' in payload)) throw Error('Missing review fixture pin');
      return [actionReview(), actionReview('action_next', 4)].find(row => JSON.stringify(row.reference) === JSON.stringify(payload.reference));
    }
    if (method === 'today.resolveAttention') return retainedAttention().dueDecisions[0];
    if (method === 'today.resolveEvent') {
      if (!('eventId' in payload)) throw Error('Missing event fixture identity');
      return sixEvents().find(event => event.id === payload.eventId)?.reference;
    }
    if (method === 'actions.list') return [currentAction(), currentAction('action_next', 4), ...['action_prepared', 'action_settled', 'action_interrupted'].map(id => currentAction(id))];
    if (method === 'decisions.list') return ['decision_created', 'decision_revised', 'decision_reviewed'].map(id => ({ id, text: `${SAFE_TEXT} ${id}`, status: 'open', reviews: [], receiptIds: [] }));
    if (method === 'receipts.get') {
      if (!('id' in payload) || typeof payload.id !== 'string') throw Error('Missing receipt fixture identity');
      return { ...fullCalculationReceiptFixture(), id: payload.id };
    }
    if (method === 'activity.list') return { items: [{ id: 'activity_fixture', event: 'Synthetic authorized activity' }], modelReceipts: [] };
    if (method === 'scenarios.discover') return { mode: 'retained-revisions', items: [], nextCursor: null, noAction: true };
    throw Error(`Unexpected synthetic Today request ${method}`);
  } };
  return { port, calls, behavior, configuration, prepared, count: (method: keyof HostRpcPayloads) => calls.filter(call => call.method === method).length,
    holdContext() { const pending = deferredToday<unknown>(); contexts.push(pending); return pending; } };
}
async function mountedToday(input: TodayProducerInput = { display: DISPLAY }, view: 'guided' | 'simple' | 'books' = 'guided', language: 'en' | 'hi' = 'en') {
  const fixture = todayTransport();
  const controller = createHostController(fixture.port, { todayProducer: input,
    firstRun: { digest: nodeDigest },
    now: () => { throw Error('Producer Today must not infer its business display from the clock'); } });
  const container = document.createElement('div'); document.body.append(container);
  const legacy = vi.fn();
  await act(async () => { const mounted = mountHost(container, controller, { view, language, onLegacyReturn: legacy }); todayDisposals.push(mounted.dispose); });
  await waitFor(() => expect(controller.snapshot().phase).toBe('ready'));
  await waitFor(() => expect(controller.todayConsumer?.snapshot().phase).toBe(input.display ? 'ready' : 'missing'));
  return { ...fixture, controller, legacy, user: userEvent.setup({ delay: null }), language };
}
async function closeTodaySheet(fixture: Awaited<ReturnType<typeof mountedToday>>) {
  await fixture.user.click(nativeButton(words('SHEET.close', fixture.language), currentSheet()));
  await waitFor(() => expect(sheetCount()).toBe(0));
}
async function openActionReview(fixture: Awaited<ReturnType<typeof mountedToday>>) {
  await fixture.user.click(nativeButton(/Producer review action_fixture/));
  const origin = nativeButton(/Producer review action_fixture/);
  await fixture.user.click(nativeButton(words('BTN.review', fixture.language)));
  await waitFor(() => expect(fixture.count('actions.list')).toBeGreaterThan(0));
  await screen.findByRole('heading', { name: /connector_fixture.*operation_fixture/ }); return origin;
}

test.each(['guided', 'simple', 'books'] as const)('mounted %s Today with missing display makes no Today read or preparation and retains honest gaps', async view => {
  const fixture = await mountedToday({}, view);
  expect(screen.getByText(words('TODAY_ENGINE.dateMissing'))).toBeTruthy();
  expect(screen.getByText(words('TODAY_ENGINE.missingDisplay'))).toBeTruthy();
  expect(fixture.count('today.get')).toBe(0); expect(fixture.count('today.prepareTiles')).toBe(0);
  expect(fixture.count('dashboard.get')).toBe(0); expect(fixture.count('receipts.get')).toBe(0);
  expect(screen.queryByRole('button', { name: words('TODAY_ENGINE.prepare') })).toBeNull();
  expect(screen.queryByRole('textbox', { name: words('TD-02.cash') })).toBeNull();
  if (view === 'simple') expect(screen.getByText(words('TODAY_ENGINE.cashMissing'))).toBeTruthy();
  if (view === 'books') { expect(screen.getByText(words('TODAY_ENGINE.queueMissing'))).toBeTruthy(); expect(screen.getByText(words('TODAY_ENGINE.closeMissing'))).toBeTruthy(); }
});

test.each(['guided', 'simple', 'books'] as const)('mounted %s Today with explicit display and absent configuration reads once without preparing or inventing figures', async view => {
  const fixture = await mountedToday({ display: DISPLAY }, view);
  expect(fixture.calls.filter(call => call.method === 'today.get').map(call => call.payload)).toEqual([DISPLAY]);
  expect(fixture.count('today.prepareTiles')).toBe(0); expect(fixture.count('receipts.get')).toBe(0); expect(fixture.count('dashboard.get')).toBe(0);
  expect(screen.getByText(words('TODAY_ENGINE.partial'))).toBeTruthy();
  expect(screen.getByRole('button', { name: words('TODAY_ENGINE.seeAll') })).toBeTruthy();
  expect(screen.queryByRole('button', { name: words('TODAY_ENGINE.prepare') })).toBeNull();
  expect(screen.queryByText('Producer exact earned huge amount')).toBeNull();
  expect(screen.queryByRole('textbox', { name: words('TD-02.cash') })).toBeNull();
});

test.each(['guided', 'simple', 'books'] as const)('mounted %s prepares only by an explicit press and primary, bucket and comparison figures open their exact receipts', async view => {
  const configuration = explicitConfiguration();
  const fixture = await mountedToday({ display: DISPLAY, configuration, charts: [{ tileId: 'earned', form: 'columns', sentence: 'Explicit producer bucket chart' }] }, view);
  expect(fixture.count('today.prepareTiles')).toBe(0);
  await fixture.user.click(nativeButton(words('TODAY_ENGINE.prepare')));
  await screen.findByRole('button', { name: 'Producer exact earned huge amount' });
  expect(fixture.count('today.prepareTiles')).toBe(1);
  expect(fixture.calls.find(call => call.method === 'today.prepareTiles')?.payload).toEqual({ ...DISPLAY, ...configuration });
  expect(fixture.calls.filter(call => call.method === 'today.get').map(call => call.payload)).toEqual([DISPLAY, { ...DISPLAY, tileCapture: fixture.prepared.reference }]);
  expect(screen.getByText('Producer missing bucket: not sure')).toBeTruthy();
  const presses = [
    { name: 'Producer exact earned huge amount', id: 'receipt_earned' },
    { name: /Producer known bucket, Producer bucket amount as written/, id: 'receipt_bucket' },
    { name: 'Producer comparison decrease as written', id: 'receipt_comparison' },
  ];
  for (const press of presses) {
    const origin = screen.getByRole('button', { name: press.name });
    expect(origin.textContent ?? origin.getAttribute('aria-label')).toContain(press.name instanceof RegExp ? 'Producer known bucket' : press.name);
    await fixture.user.click(origin);
    await screen.findByRole('heading', { name: press.id });
    expect(sheetCount()).toBe(1);
    expect(fixture.calls.filter(call => call.method === 'receipts.get').at(-1)?.payload).toEqual({ id: press.id });
    await closeTodaySheet(fixture); expect(document.activeElement).toBe(origin);
  }
  const definitionOrigin = screen.getAllByRole('button', { name: words('TODAY_ENGINE.definition') })[0]!;
  const beforeDefinition = fixture.calls.length;
  await fixture.user.click(definitionOrigin);
  await screen.findByRole('heading', { name: 'Producer earned' });
  expect(fixture.calls.length).toBe(beforeDefinition);
  expect(currentSheet().getAllByText('Only released source rows count.').length).toBeGreaterThan(0);
  expect(currentSheet().getAllByText('Producer source coverage is incomplete.').length).toBeGreaterThan(0);
  expect(currentSheet().getAllByText('Producer has not released all rows.').length).toBeGreaterThan(0);
  expect(currentSheet().getByText('No released bucket evidence.')).toBeTruthy();
  for (const id of ['receipt_earned', 'receipt_bucket', 'receipt_comparison']) expect(currentSheet().getByRole('button', { name: `Open receipt ${id}` })).toBeTruthy();
  await fixture.user.click(nativeButton('Open receipt receipt_bucket', currentSheet()));
  await screen.findByRole('heading', { name: 'receipt_bucket' });
  expect(sheetCount()).toBe(1);
  await fixture.user.click(nativeButton(words('SHEET.back', fixture.language).replace('{what}', words('TODAY_ENGINE.detail', fixture.language)), currentSheet()));
  await screen.findByRole('heading', { name: 'Producer earned' });
  await closeTodaySheet(fixture); expect(document.activeElement).toBe(definitionOrigin);
  expect(fixture.count('today.prepareTiles')).toBe(1); expect(fixture.count('dashboard.get')).toBe(0);
});

test('mounted Review resolves the complete current pin then opens a genuine action record without approving it', async () => {
  const fixture = await mountedToday(); const origin = await openActionReview(fixture);
  expect(fixture.calls.filter(call => call.method === 'today.resolveReview').map(call => call.payload)).toEqual([{ reference: actionReview().reference }]);
  expect(currentSheet().getByText('action_fixture')).toBeTruthy();
  expect(currentSheet().getByText(SAFE_TEXT)).toBeTruthy();
  expect(document.querySelector('img, script')).toBeNull();
  expect(currentSheet().queryByRole('button', { name: /Approve|Run|Prepare/ })).toBeNull();
  expect(fixture.count('today.prepareTiles')).toBe(0); expect(fixture.count('receipts.get')).toBe(0);
  await closeTodaySheet(fixture); expect(document.activeElement).toBe(origin);
});

test('native attention detail replaces the one sheet with receipt proof, refuses its connected old Close, and returns through Back to the accepted origin', async () => {
  const fixture = await mountedToday(); const origin = nativeButton(new RegExp('Hindi'));
  await fixture.user.click(origin);
  await screen.findByRole('heading', { name: SAFE_TEXT });
  expect(fixture.calls.filter(call => call.method === 'today.resolveAttention').map(call => call.payload)).toEqual([{ ...DISPLAY, reference: retainedAttention().dueDecisions[0]!.reference }]);
  expect(document.activeElement).toBe(currentSheet().getByRole('heading', { name: SAFE_TEXT }));
  const proof = nativeButton('Open receipt receipt_decision', currentSheet());
  const oldClose = nativeButton(words('SHEET.close'), currentSheet());
  const atDetail = window.location.hash;
  act(() => { proof.click(); expect(oldClose.isConnected).toBe(true); oldClose.click(); expect(window.location.hash).toBe(atDetail); });
  await screen.findByRole('heading', { name: 'receipt_decision' });
  expect(sheetCount()).toBe(1); expect(fixture.count('receipts.get')).toBe(1);
  expect(document.querySelector('img, script')).toBeNull();
  await fixture.user.click(nativeButton(words('SHEET.back', fixture.language).replace('{what}', words('TODAY_ENGINE.detail', fixture.language)), currentSheet()));
  await screen.findByRole('heading', { name: SAFE_TEXT });
  expect(sheetCount()).toBe(1); expect(fixture.count('today.resolveAttention')).toBe(1);
  await closeTodaySheet(fixture); expect(document.activeElement).toBe(origin);
});

test.each(['en', 'hi'] as const)('six producer events in %s retain their order, resolve exact identities and open current native records with safe localized text', async language => {
  const fixture = await mountedToday({ display: DISPLAY }, 'guided', language);
  const events = sixEvents();
  const names = events.map(event => words(`TODAY_ENGINE.event.${event.kind}`, language));
  const controls = names.map(name => nativeButton(new RegExp(name)));
  expect(controls).toHaveLength(6);
  expect(controls.map(control => control.textContent?.includes('12:30'))).toEqual(Array(6).fill(true));
  expect(screen.getAllByText(words('TODAY_ENGINE.actorMissing', language)).length).toBeGreaterThan(0);
  if (language === 'hi') expect(names.every(name => /[\u0900-\u097f]/.test(name))).toBe(true);
  for (let index = 0; index < events.length; index++) {
    await fixture.user.click(nativeButton(new RegExp(names[index]!)));
    await waitFor(() => expect(fixture.count('today.resolveEvent')).toBe(index + 1));
    await waitFor(() => expect(sheetCount()).toBe(1));
    const event = events[index]!;
    expect(fixture.calls.filter(call => call.method === 'today.resolveEvent').at(-1)?.payload).toEqual({ ...DISPLAY, eventId: event.id });
    const currentRecord = recordedGroup('current');
    if (event.reference.kind === 'decision') expect(currentRecord.getByText(event.reference.decisionId)).toBeTruthy();
    if (event.reference.kind === 'action') expect(currentRecord.getByText(event.reference.actionId)).toBeTruthy();
    assertCapturedEvent(event, language);
    expect(document.querySelector('img, script')).toBeNull();
    await closeTodaySheet(fixture);
  }
  expect(fixture.count('decisions.list')).toBe(3); expect(fixture.count('actions.list')).toBe(3);
  await fixture.user.click(nativeButton(words('TODAY_ENGINE.activity', language)));
  await waitFor(() => expect(sheetCount()).toBe(1));
  expect(currentSheet().getByText(words('TODAY_ENGINE.activityPartial', language))).toBeTruthy();
  expect(recordedGroup('items').getByText('Synthetic authorized activity')).toBeTruthy();
  expect(recordedGroup('items').getAllByRole('listitem')).toHaveLength(1);
  expect(recordedGroup('modelReceipts').queryAllByRole('listitem')).toHaveLength(0);
  expect(fixture.controller.todayConsumer!.snapshot().detail?.record).toEqual({ items: [{ id: 'activity_fixture', event: 'Synthetic authorized activity' }], modelReceipts: [] });
  expect(fixture.count('activity.list')).toBe(1); expect(fixture.count('today.prepareTiles')).toBe(0);
});

test('scoped review preserves its opaque continuation and a later row resolves its own full pin', async () => {
  const fixture = await mountedToday();
  await fixture.user.click(nativeButton(words('TODAY_ENGINE.seeAll')));
  await screen.findByRole('heading', { name: words('TODAY_ENGINE.scope') });
  expect(currentSheet().getByText(words('TODAY_ENGINE.scope.complete'))).toBeTruthy();
  await fixture.user.click(nativeButton(words('TODAY_ENGINE.next'), currentSheet()));
  await currentSheet().findByRole('button', { name: 'Producer review action_next' });
  expect(fixture.calls.filter(call => call.method === 'today.review').map(call => call.payload)).toEqual([{ limit: 4 }, { limit: 4, cursor: reviewQueue().nextCursor }]);
  await fixture.user.click(nativeButton('Producer review action_next', currentSheet()));
  await screen.findByRole('heading', { name: /connector_fixture.*operation_fixture/ });
  expect(fixture.calls.filter(call => call.method === 'today.resolveReview').at(-1)?.payload).toEqual({ reference: actionReview('action_next', 4).reference });
  expect(currentSheet().getByText('action_next')).toBeTruthy(); expect(fixture.count('actions.list')).toBe(1);
});

test('connected controls from the replaced same-address Today view dispatch nothing while fresh review controls still work', async () => {
  const fixture = await mountedToday({ display: DISPLAY, configuration: explicitConfiguration() });
  await fixture.user.click(nativeButton(words('TODAY_ENGINE.prepare')));
  await screen.findByRole('button', { name: 'Producer exact earned huge amount' });
  await fixture.user.click(nativeButton(/Producer review action_fixture/));
  const oldReview = nativeButton(words('BTN.review'));
  const oldPrepare = nativeButton(words('TODAY_ENGINE.prepare'));
  const oldScope = nativeButton(words('TODAY_ENGINE.seeAll'));
  const oldEvent = nativeButton(/Decision recorded/);
  const oldAttention = nativeButton(/Hindi/);
  const oldReceipt = nativeButton('Producer exact earned huge amount');
  const before = fixture.calls.length;
  let pending: Promise<void> | undefined;
  act(() => {
    pending = fixture.controller.todayConsumer!.refresh();
    for (const control of [oldReview, oldPrepare, oldScope, oldEvent, oldAttention, oldReceipt]) { expect(control.isConnected).toBe(true); control.click(); }
  });
  await act(async () => { await pending; });
  expect(fixture.calls.slice(before).filter(call => call.method !== 'ui.context').map(call => call.method)).toEqual(['today.get']);
  expect(sheetCount()).toBe(0); expect(window.location.hash).toBe('#/today/today');
  await fixture.user.click(nativeButton(words('BTN.review')));
  await screen.findByRole('heading', { name: /connector_fixture.*operation_fixture/ });
  expect(fixture.count('today.resolveReview')).toBe(1); expect(fixture.count('actions.list')).toBe(1);
  await closeTodaySheet(fixture);
  await fixture.user.click(nativeButton('Producer exact earned huge amount'));
  await screen.findByRole('heading', { name: 'receipt_earned' });
  expect(fixture.count('receipts.get')).toBe(1);
  await closeTodaySheet(fixture);
  await fixture.user.click(nativeButton(words('TODAY_ENGINE.prepare')));
  await waitFor(() => expect(fixture.count('today.prepareTiles')).toBe(2));
  await screen.findByRole('button', { name: 'Producer exact earned huge amount' });
});

test('actual hash departure during held host context preflight issues zero Today resolver calls and a fresh returned row remains usable', async () => {
  const fixture = await mountedToday();
  await fixture.user.click(nativeButton(/Producer review action_fixture/));
  const held = fixture.holdContext(), contextReads = fixture.count('ui.context');
  await fixture.user.click(nativeButton(words('BTN.review')));
  await waitFor(() => expect(fixture.count('ui.context')).toBe(contextReads + 1));
  expect(fixture.count('today.resolveReview')).toBe(0);
  act(() => { window.location.hash = '#/books/sources'; held.resolve(CONTEXT); });
  await settleToday();
  await waitFor(() => expect(screen.queryByRole('button', { name: /Producer review action_fixture/ })).toBeNull());
  expect(fixture.count('today.resolveReview')).toBe(0); expect(fixture.count('actions.list')).toBe(0); expect(sheetCount()).toBe(0);
  expect(window.location.hash).toBe('#/books/sources');
  act(() => { window.location.hash = '#/today/today'; });
  await screen.findByRole('button', { name: /Producer review action_fixture/ });
  await openActionReview(fixture);
  expect(fixture.count('today.resolveReview')).toBe(1); expect(fixture.count('actions.list')).toBe(1);
});

test('Saved discovery and returning to legacy coexist with independent Today and never prepare figures automatically', async () => {
  const fixture = await mountedToday();
  act(() => { window.location.hash = '#/ask/saved'; });
  await waitFor(() => expect(fixture.count('scenarios.discover')).toBe(1));
  await screen.findByText(words('RETAINED.saved.empty'));
  expect(fixture.count('today.prepareTiles')).toBe(0); expect(fixture.count('dashboard.get')).toBe(0);
  act(() => { window.location.hash = '#/today/today'; });
  await screen.findByRole('button', { name: /Producer review action_fixture/ });
  expect(fixture.count('today.get')).toBe(2); expect(fixture.count('today.prepareTiles')).toBe(0);
  await fixture.user.click(screen.getAllByRole('button', { name: 'Previous interface' })[0]!);
  expect(fixture.legacy).toHaveBeenCalledTimes(1); expect(fixture.count('today.prepareTiles')).toBe(0);
});

test.each([
  { via: 'Close', settlement: 'success' },
  { via: 'Close', settlement: 'refusal' },
  { via: 'Esc', settlement: 'success' },
  { via: 'Esc', settlement: 'refusal' },
] as const)('held proof cancelled by current $via stays closed after late $settlement without hash, private-state or focus resurrection', async ({ via, settlement }) => {
  const fixture = await mountedToday();
  const origin = nativeButton(/Hindi/);
  await fixture.user.click(origin);
  await screen.findByRole('heading', { name: SAFE_TEXT });
  const held = deferredToday<unknown>();
  fixture.behavior.set('receipts.get', () => held.promise);
  await fixture.user.click(nativeButton('Open receipt receipt_decision', currentSheet()));
  await waitFor(() => expect(fixture.count('receipts.get')).toBe(1));
  await settleToday();
  expect(fixture.controller.todayConsumer?.snapshot().detail).toBeNull();
  expect(currentSheet().getByRole('heading', { name: SAFE_TEXT })).toBeTruthy();
  expect(sheetCount()).toBe(1); expect(window.location.hash).toBe('#/today/today?sheet=today-record');
  if (via === 'Close') await fixture.user.click(nativeButton(words('SHEET.close'), currentSheet()));
  else await fixture.user.keyboard('{Escape}');
  await waitFor(() => expect(sheetCount()).toBe(0));
  expect(window.location.hash).toBe('#/today/today'); expect(document.activeElement).toBe(origin);
  const cancelled = fixture.controller.todayConsumer!.snapshot();
  const marker = nativeButton(words('TODAY_ENGINE.seeAll')); marker.focus();
  expect(document.activeElement).toBe(marker);
  const callsAfterCancellation = fixture.calls.length;
  await act(async () => {
    if (settlement === 'success') held.resolve({ ...fullCalculationReceiptFixture(), id: 'receipt_decision' });
    else held.reject(Object.assign(Error('Synthetic late authority refusal'), { code: 'ACCESS_DENIED' }));
    for (let index = 0; index < 16; index++) await Promise.resolve();
  });
  await settleToday();
  expect(sheetCount()).toBe(0); expect(window.location.hash).toBe('#/today/today');
  expect(document.activeElement).toBe(marker);
  expect(screen.queryByRole('heading', { name: 'receipt_decision' })).toBeNull();
  expect(fixture.controller.todayConsumer!.snapshot()).toBe(cancelled);
  expect(fixture.controller.todayConsumer!.snapshot().detail).toBeNull();
  expect(fixture.controller.snapshot().phase).toBe('ready');
  expect(fixture.calls.length).toBe(callsAfterCancellation);
  expect(fixture.count('receipts.get')).toBe(1); expect(fixture.count('today.prepareTiles')).toBe(0);
});

test('a connected Close from the previous sheet cannot consume a newer checked proof before commit, while the fresh accepted Close still works', async () => {
  const fixture = await mountedToday(); const origin = nativeButton(/Hindi/);
  await fixture.user.click(origin); await screen.findByRole('heading', { name: SAFE_TEXT });
  const held = deferredToday<unknown>(); fixture.behavior.set('receipts.get', () => held.promise);
  await fixture.user.click(nativeButton('Open receipt receipt_decision', currentSheet()));
  await waitFor(() => expect(fixture.count('receipts.get')).toBe(1));
  await settleToday();
  const oldClose = nativeButton(words('SHEET.close'), currentSheet());
  let observedReplacement = false;
  const unsubscribe = fixture.controller.todayConsumer!.subscribe(() => {
    const accepted = fixture.controller.todayConsumer!.snapshot();
    if (observedReplacement || accepted.detail?.kind !== 'receipt') return;
    observedReplacement = true;
    expect(oldClose.isConnected).toBe(true);
    const beforePress = window.location.hash; oldClose.click();
    expect(window.location.hash).toBe(beforePress);
    expect(fixture.controller.todayConsumer!.snapshot()).toBe(accepted);
  });
  try {
    await act(async () => { held.resolve({ ...fullCalculationReceiptFixture(), id: 'receipt_decision' }); for (let index = 0; index < 16; index++) await Promise.resolve(); });
    await screen.findByRole('heading', { name: 'receipt_decision' });
    expect(observedReplacement).toBe(true); expect(sheetCount()).toBe(1);
    expect(window.location.hash).toBe('#/today/today?sheet=today-proof');
    expect(fixture.controller.todayConsumer!.snapshot().detail?.kind).toBe('receipt');
    await closeTodaySheet(fixture);
    expect(document.activeElement).toBe(origin); expect(window.location.hash).toBe('#/today/today');
    expect(fixture.count('receipts.get')).toBe(1);
  } finally { unsubscribe(); }
});

test.each(['en', 'hi'] as const)('captured refusal reason and actor in %s remain visible beside the genuine current learning record', async language => {
  const fixture = await mountedToday({ display: DISPLAY }, 'guided', language);
  const event: TodayDayEvent = { id: 'event_refusal', at: TODAY_AT, actor: { kind: 'member', memberId: 'member_recorded_actor' }, kind: 'source.import-refused', args: { sourceId: 'source_orders', reasonCode: 'unsupported_shape', qualification: 'experimental' }, reference: { kind: 'import-refusal', learningEventId: 'learning_fixture' } };
  const native = { id: 'learning_fixture', type: 'decision', importIdentity: { sourceId: 'source_orders', outcome: 'rejected', qualification: 'experimental' }, input: { reasonCode: 'unsupported_shape', narration: SAFE_TEXT }, recordIntegrity: 'b'.repeat(64) };
  fixture.behavior.set('today.get', () => ({ ...engineToday(), dayEvents: { state: 'available', value: { ...DISPLAY, calendarRevision: null, events: [event], total: 1, state: { kind: 'complete', reasonCodes: [] } } } }));
  fixture.behavior.set('today.resolveEvent', () => event.reference);
  fixture.behavior.set('learning.list', () => [native]);
  await act(async () => { await fixture.controller.todayConsumer!.refresh(); });
  await fixture.user.click(nativeButton(new RegExp(words('TODAY_ENGINE.event.source.import-refused', language))));
  await screen.findByRole('heading', { name: 'source_orders' });
  expect(fixture.calls.filter(call => call.method === 'today.resolveEvent').at(-1)?.payload).toEqual({ ...DISPLAY, eventId: event.id });
  assertCapturedEvent(event, language);
  const currentRecord = recordedGroup('current');
  expect(currentRecord.getByText('learning_fixture')).toBeTruthy(); expect(currentRecord.getByText(SAFE_TEXT)).toBeTruthy();
  expect(currentRecord.getByText('rejected')).toBeTruthy(); expect(fixture.count('learning.list')).toBe(1);
  expect(fixture.controller.todayConsumer!.snapshot().detail?.record).toEqual({ event, current: native });
  expect(document.querySelector('img, script')).toBeNull(); expect(sheetCount()).toBe(1);
  await closeTodaySheet(fixture);
});
