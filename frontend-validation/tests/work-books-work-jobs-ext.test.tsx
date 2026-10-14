import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language } from '../../app/ui/src/app/presentation';
import { workPlace } from '../../app/ui/src/screens/work/index';
import { measureChart } from '../../app/ui/src/screens/work/parts/MeasureChart';
import { jobWords } from '../../app/ui/src/screens/work/text-jobs';

// Every reply here is synthetic and shaped by docs/lanes/work-books.md ("Jobs: round 2").
type Handler = (payload: Record<string, unknown>) => unknown;
const refuse = (code: string) => Object.assign(new Error(code), { code });
function fakeRpc(handlers: Record<string, Handler>) {
  return { request: vi.fn(async (method: string, payload: Record<string, unknown>) => { const h = handlers[method]; if (!h) throw refuse('UNKNOWN_METHOD'); return h(payload); }) };
}
function Harness({ rpc, start, language, role, onReceipt }: { rpc: ReturnType<typeof fakeRpc>; start: Address; language: Language; role: string; onReceipt: (id: string) => void }) {
  const [address, setAddress] = useState<Address>(start);
  return (
    <TextProvider language={language}>
      {workPlace.render({ address, language, view: 'guided', viewer: role === 'viewer', rpc, member: { id: 'member-1', role }, live: () => true, openReceipt: onReceipt,
        navigate: next => setAddress(next ?? { place: 'work', sub: address.sub ?? 'approvals' }) })}
    </TextProvider>
  );
}
function show(handlers: Record<string, Handler>, start: Address, opts: { language?: Language; role?: string } = {}) {
  const rpc = fakeRpc(handlers); const onReceipt = vi.fn();
  render(<Harness rpc={rpc} start={start} language={opts.language ?? 'en'} role={opts.role ?? 'owner'} onReceipt={onReceipt} />);
  return { rpc, onReceipt };
}
beforeEach(() => { vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const card = {
  id: 'job_1', goal: 'Work out what customers owe each month end.', doneWhen: 'When its owner accepts the result.', owner: 'Owner', budget: { minor: '20000' }, reserve: { minor: '20000' }, spent: { minor: '0' },
  stopRule: { maxRuns: 12, deadline: '2027-10-14T00:00:00Z' }, actions: [], testedRoutes: [], reviewOn: null, missedRun: 'skip',
  runsOn: 'this-computer', runs: 2, lastRunAt: null, nextRunAt: '2026-10-31T12:30:00Z', untrustedInstructions: false, digest: 'jd-1', revision: 1,
};
const row = { id: 'job_1', goal: card.goal, state: 'scheduled', reason: null, nextRunAt: '2026-10-31T12:30:00Z', resumesAt: null, spent: { minor: '0' }, budget: { minor: '20000' }, can: ['pause', 'cancel'] };
const JOBS = () => ({ items: [row], active: 1, limit: 10, proposals: { available: false } });
const person = (stepId: string, extra: Record<string, unknown> = {}) => ({ at: '2026-10-14T00:00:00Z', event: 'person-step', amount: null, needsModel: false, reason: null, kind: 'person', stepId, what: 'File the GST return on the portal.', who: { kind: 'you', name: 'Owner', memberId: 'member-1' }, done: false, doneAt: null, doneBy: null, canDone: true, ...extra });
const MEASURE = { name: 'Receivable aging', goal: { minor: '50000' }, goalReceiptId: 'goal-r', points: [
  { at: '2026-08-31T12:30:00Z', value: { minor: '120000' }, receiptId: 'r1' },
  { at: '2026-09-15T12:30:00Z', value: { missing: 'withheld' }, receiptId: 'r2' },
  { at: '2026-09-30T12:30:00Z', value: { minor: '90000' }, receiptId: 'r3' },
] };
const sheet = (extra: Record<string, unknown> = {}) => ({
  ...card, result: null, timeline: [person('file-gst'), { at: '2026-10-01T00:00:00Z', event: 'created', amount: null, needsModel: null, reason: null }],
  measure: MEASURE, schedule: { kind: 'calendar', rule: 'month-end', at: '18:00', timeZone: 'Asia/Kolkata', paused: false },
  manage: { edit: 'core', delete: 'cancel', missedRule: 'core', personStep: 'jobsx' }, ...extra,
});

test('WK-16: a person step leads the time line with who and Done, and Done goes to the engine', async () => {
  let done = false;
  const { rpc } = show({
    'approvals.jobs': JOBS,
    'approvals.job': () => sheet({ timeline: [person('file-gst', done ? { done: true, doneAt: '2026-10-14T10:00:00Z', doneBy: 'Owner', canDone: false } : {}),
      person('call', { what: 'Call the customer about the late invoice.', who: { kind: 'person', name: 'Asha Accountant', memberId: 'acc' }, canDone: false })] }),
    'approvals.personStepDone': p => { done = true; return { jobId: p.jobId, stepId: p.stepId, done: true }; },
  }, { place: 'work', sub: 'jobs', sheet: 'job__1' });
  await screen.findByText('File the GST return on the portal.');
  const step = document.querySelector('[data-person-step="file-gst"]') as HTMLElement;
  expect(within(step).getByText('File the GST return on the portal.')).toBeTruthy();
  expect(within(step).getByText(/You · The job waits for this step/)).toBeTruthy();
  const other = document.querySelector('[data-person-step="call"]') as HTMLElement;
  expect(within(other).getByText('This step is for Asha Accountant.')).toBeTruthy();
  expect(within(other).queryByRole('button', { name: 'Done' })).toBeNull();
  await userEvent.click(within(step).getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.personStepDone', { jobId: 'job_1', stepId: 'file-gst' }));
  await waitFor(() => expect(screen.getByText(/Done on .* by Owner/)).toBeTruthy());
});

test('WK-16: without job extensions the step says Done is not built, in Hindi too', async () => {
  show({ 'approvals.jobs': JOBS, 'approvals.job': () => sheet({ manage: { edit: 'not-built', delete: 'cancel', missedRule: 'not-built', personStep: 'not-built' } }) },
    { place: 'work', sub: 'jobs', sheet: 'job__1' }, { language: 'hi' });
  expect(await screen.findByText('क़दम को पूरा बताना जॉब एक्सटेंशन के साथ आएगा। अभी बना नहीं है।')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'हो गया' })).toBeNull();
  expect(screen.getByText(/इस जॉब को बदलना अभी बना नहीं है/)).toBeTruthy();
});

test('WK-08: the measure chart places the engine points, opens each receipt and writes the gap in words', async () => {
  const { onReceipt } = show({ 'approvals.jobs': JOBS, 'approvals.job': () => sheet() }, { place: 'work', sub: 'jobs', sheet: 'job__1' });
  expect(await screen.findByText('The measure against its goal')).toBeTruthy();
  const chart = document.querySelector('[data-measure]') as HTMLElement;
  expect(within(chart).getByText('15 Sep 2026: hidden from your seat')).toBeTruthy();
  expect(within(chart).getByText('1 runs have no figure you can read. They show as gaps.')).toBeTruthy();
  const marks = within(chart).getAllByRole('button');
  expect(marks.length).toBe(3); // two known points and the goal
  await userEvent.click(marks[0]!);
  expect(onReceipt).toHaveBeenCalledWith('r1');
  // The chart description is the engine values as given: no arithmetic, the gap stays missing.
  const c = measureChart(MEASURE as any, jobWords('en'), 'en');
  expect(c.values.map(v => (v.value.kind === 'missing' ? v.value.missing : v.value.exact))).toEqual(['120000', 'withheld', '90000']);
  expect(c.goal.value.kind === 'money' && c.goal.value.receiptId).toBe('goal-r');
});

test('WK-08: no measure says so; a goal without a receipt is written, not drawn', async () => {
  show({ 'approvals.jobs': JOBS, 'approvals.job': () => sheet({ measure: null }) }, { place: 'work', sub: 'jobs', sheet: 'job__1' });
  expect(await screen.findByText('This job has no measure yet: no run has named a calculation.')).toBeTruthy();
  cleanup();
  show({ 'approvals.jobs': JOBS, 'approvals.job': () => sheet({ measure: { ...MEASURE, goalReceiptId: null } }) }, { place: 'work', sub: 'jobs', sheet: 'job__1' });
  expect(await screen.findByText(/Goal set on the job: ₹500\. It has no receipt/)).toBeTruthy();
});

test('WK-11 and Edit: the schedule reads month-end; the missed-run rule and the edit go to the engine as paise', async () => {
  const { rpc } = show({
    'approvals.jobs': JOBS, 'approvals.job': () => sheet(),
    'approvals.setMissedRule': p => ({ id: 'job:job_1', missedRun: p.rule, via: 'core' }),
    'approvals.editJob': () => ({ id: 'job:job_1', via: 'core' }),
  }, { place: 'work', sub: 'jobs', sheet: 'job__1' });
  expect(await screen.findByText('the last day of each month at 18:00 (Asia/Kolkata)')).toBeTruthy();
  const rule = screen.getByRole('form', { name: 'Change the missed-run rule' });
  await userEvent.click(within(rule).getByRole('radio', { name: 'run once on wake' }));
  await userEvent.click(within(rule).getByRole('button', { name: 'Save the rule' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.setMissedRule', { id: 'job_1', rule: 'run-once-on-wake' }));
  expect(await screen.findByText('Changed. The job waits for your approval again.')).toBeTruthy();

  await userEvent.click(screen.getByRole('button', { name: 'Edit the job' }));
  const form = screen.getByRole('form', { name: 'Edit' });
  await userEvent.click(within(form).getByRole('button', { name: 'Save the change' }));
  expect(within(form).getByRole('alert').textContent).toBe('Change at least one thing.');
  const budget = within(form).getByLabelText('Budget in rupees'); await userEvent.clear(budget); await userEvent.type(budget, '300.50');
  const runs = within(form).getByLabelText('Most runs (1 to 366)'); await userEvent.clear(runs); await userEvent.type(runs, '6');
  await userEvent.click(within(form).getByRole('button', { name: 'Save the change' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.editJob', { id: 'job_1', config: { budgetMinor: '30050', maxRuns: 6 } }));
  expect(await screen.findByText('Changed. It waits for your approval.')).toBeTruthy();
});

test('Delete asks first, says cancel keeps the record, and a refusal shows its code', async () => {
  let calls = 0;
  const { rpc } = show({
    'approvals.jobs': JOBS, 'approvals.job': () => sheet(),
    'approvals.deleteJob': () => { calls += 1; if (calls === 1) throw refuse('INVALID_JOB_STATE'); return { id: 'job_1', state: 'cancelled', note: 'cancel-keeps-record' }; },
  }, { place: 'work', sub: 'jobs', sheet: 'job__1' });
  await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  const dialog = screen.getByRole('alertdialog', { name: 'Delete this job?' });
  expect(within(dialog).getByText(/Delete cancels the job: it stops, and its record is kept/)).toBeTruthy();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete it' }));
  expect(await screen.findByText('Refused. Code INVALID_JOB_STATE.')).toBeTruthy();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete it' }));
  expect(await screen.findByText('Cancelled. The job has stopped; its record is kept.')).toBeTruthy();
  expect(rpc.request).toHaveBeenCalledWith('approvals.deleteJob', { id: 'job_1' });
});

test('a viewer sees the schedule but no Edit, Delete, rule or Done', async () => {
  show({ 'approvals.jobs': JOBS, 'approvals.job': () => sheet({ timeline: [person('file-gst', { canDone: false })] }) }, { place: 'work', sub: 'jobs', sheet: 'job__1' }, { role: 'viewer' });
  expect(await screen.findByText('the last day of each month at 18:00 (Asia/Kolkata)')).toBeTruthy();
  for (const name of ['Edit the job', 'Delete', 'Save the rule', 'Done']) expect(screen.queryByRole('button', { name })).toBeNull();
});

test('a bad person step fails the sheet with INVALID_REPLY', async () => {
  show({ 'approvals.jobs': JOBS, 'approvals.job': () => sheet({ timeline: [person('x', { who: { kind: 'robot', name: 'R', memberId: null } })] }) }, { place: 'work', sub: 'jobs', sheet: 'job__1' });
  expect(await screen.findByText(/INVALID_REPLY/)).toBeTruthy();
});

const TEMPLATES = (monthEnd: boolean) => ({
  templates: [{ id: 'month-end-brief', title: 'Month-end brief', goal: 'Write a month-end brief.', doneWhen: 'A brief is ready each month, and you accept it.', type: 'owner-brief', every: 'month', schedule: 'month-end', budget: { minor: '20000' }, maxRuns: 12, days: 366, missedRun: 'skip', actions: [], needsModel: false }],
  fromSentence: { available: false }, monthEnd: { available: monthEnd },
});

test('month-end on the calendar is the default when available', async () => {
  const { rpc } = show({ 'approvals.jobs': () => ({ items: [], active: 0, limit: 10, proposals: { available: false } }), 'approvals.jobTemplates': () => TEMPLATES(true), 'approvals.proposeJob': () => ({ id: 'job:job_9' }), 'approvals.get': () => { throw refuse('NOT_FOUND'); },
    'approvals.list': () => ({ items: [], expired: [], snoozed: 0, counts: { tier2: 0, tier1: 0, prepareOnly: 0 } }), 'approvals.pace': () => ({ fastStreak: 0, warn: false }) }, { place: 'work', sub: 'jobs', sheet: 'start' });
  await userEvent.click(await screen.findByRole('button', { name: 'Choose Month-end brief' }));
  expect(screen.getAllByText('On the last day of each month, 18:00 India time').length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole('button', { name: 'Propose' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.proposeJob', { templateId: 'month-end-brief', budgetMinor: '20000', maxRuns: 12, missedRun: 'skip', schedule: 'month-end' }));
});

test('without calendar rules month-end cannot be picked, and every 30 days is chosen by the person', async () => {
  const { rpc } = show({ 'approvals.jobs': () => ({ items: [], active: 0, limit: 10, proposals: { available: false } }), 'approvals.jobTemplates': () => TEMPLATES(false), 'approvals.proposeJob': () => ({ id: 'job:job_9' }) }, { place: 'work', sub: 'jobs', sheet: 'start' });
  await userEvent.click(await screen.findByRole('button', { name: 'Choose Month-end brief' }));
  expect((screen.getByRole('radio', { name: 'On the last day of each month, 18:00 India time' }) as HTMLInputElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Propose' }));
  expect(screen.getByRole('alert').textContent).toMatch(/not available on this computer/);
  expect(rpc.request).not.toHaveBeenCalledWith('approvals.proposeJob', expect.anything());
  await userEvent.click(screen.getByRole('radio', { name: 'Every 30 days, not month-end' }));
  await userEvent.click(screen.getByRole('button', { name: 'Propose' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.proposeJob', expect.objectContaining({ templateId: 'month-end-brief', schedule: 'every-30-days' })));
});

const RULES = { windows: 1, mode: 'read-export', typesSecrets: false };
test('WK-14: driving says not built yet without the session lane, with its rules', async () => {
  show({ 'approvals.drivingStatus': () => ({ available: false, rules: RULES }) }, { place: 'work', sub: 'driving' });
  expect(await screen.findByText('Driving a program is not built yet. It arrives with the session lane.')).toBeTruthy();
  expect(screen.getByText(/never types a password, never answers a one-time code/)).toBeTruthy();
  expect(screen.queryByText('Chausar is driving. Ctrl Alt Pause to stop.')).toBeNull();
  cleanup();
  show({}, { place: 'work', sub: 'driving' });
  expect(await screen.findByText(/Not built yet/i)).toBeTruthy();
});

test('WK-14: choose one window, then the banner with Stop; paused offers Continue; stopped by key and a failed step say so', async () => {
  let state: any = { state: 'idle', window: null, steps: [], reason: null };
  const reply = () => ({ available: true, rules: RULES, status: state, windows: [{ id: 'w1', title: 'Tally Prime', app: 'tally' }, { id: 'w2', title: 'Zoho Books', app: 'browser' }] });
  const { rpc } = show({
    'approvals.drivingStatus': reply,
    'approvals.drivingStart': p => { state = { state: 'paused-by-you', window: { id: p.windowId, title: 'Tally Prime' }, steps: [{ at: '2026-10-14T10:00:00Z', text: 'Open the day book', state: 'done' }], reason: null }; return reply(); },
    'approvals.drivingContinue': () => { state = { ...state, state: 'driving' }; return reply(); },
    'approvals.drivingStop': () => { state = { ...state, state: 'stopped-by-key' }; return reply(); },
  }, { place: 'work', sub: 'driving' });
  expect(await screen.findByText('Not driving.')).toBeTruthy();
  const start = screen.getByRole('button', { name: 'Start in this window' });
  expect((start as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole('radio', { name: 'Tally Prime · tally' }));
  await userEvent.click(start);
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.drivingStart', { windowId: 'w1' }));
  expect(await screen.findByText('Chausar is driving. Ctrl Alt Pause to stop.')).toBeTruthy();
  expect(screen.getByText('You moved the mouse. Paused.')).toBeTruthy();
  expect(screen.getByText('Open the day book')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull());
  await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
  expect(await screen.findByText('Stopped by your key.')).toBeTruthy();
  cleanup();
  state = { state: 'step-failed', window: null, steps: [{ at: '2026-10-14T10:01:00Z', text: 'Export the report', state: 'failed' }], reason: null };
  show({ 'approvals.drivingStatus': reply }, { place: 'work', sub: 'driving' }, { language: 'hi' });
  expect(await screen.findByText('एक क़दम असफल हुआ।')).toBeTruthy();
  state = { state: 'sign-in', window: { id: 'w1', title: 'Tally Prime' }, steps: [], reason: null };
  cleanup();
  show({ 'approvals.drivingStatus': reply }, { place: 'work', sub: 'driving' }, { role: 'viewer' });
  expect(await screen.findByText('Sign in yourself. Chausar continues after.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Start in this window' })).toBeNull();
});
