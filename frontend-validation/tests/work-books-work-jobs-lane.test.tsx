import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language } from '../../app/ui/src/app/presentation';
import { workPlace } from '../../app/ui/src/screens/work/index';

// Every reply is synthetic and shaped by docs/lanes/work-books.md ("Work: jobs, round 2"): the sheet of a job
// run by job extensions (jobs-ext), as approvals.job maps it from jobsx.get.
type Handler = (payload: Record<string, unknown>) => unknown;
const refuse = (code: string) => Object.assign(new Error(code), { code });
function fakeRpc(handlers: Record<string, Handler>) {
  return { request: vi.fn(async (method: string, payload: Record<string, unknown>) => { const h = handlers[method]; if (!h) throw refuse('UNKNOWN_METHOD'); return h(payload); }) };
}
function Harness({ rpc, start, language, role }: { rpc: ReturnType<typeof fakeRpc>; start: Address; language: Language; role: string }) {
  const [address, setAddress] = useState<Address>(start);
  return (
    <TextProvider language={language}>
      {workPlace.render({ address, language, view: 'guided', viewer: role === 'viewer', rpc, member: { id: 'member-1', role }, live: () => true, openReceipt: () => {},
        navigate: next => setAddress(next ?? { place: 'work', sub: address.sub ?? 'approvals' }) })}
    </TextProvider>
  );
}
function show(handlers: Record<string, Handler>, opts: { language?: Language } = {}) {
  const rpc = fakeRpc(handlers);
  render(<Harness rpc={rpc} start={{ place: 'work', sub: 'jobs', sheet: 'job__1' }} language={opts.language ?? 'en'} role="owner" />);
  return { rpc };
}
beforeEach(() => { vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const card = {
  id: 'job_1', goal: 'Close the week: net sales, margin and what customers owe.', doneWhen: 'When its owner accepts the result.', owner: 'Owner', budget: { minor: '2000' }, reserve: { minor: '20' }, spent: { minor: '1200' },
  stopRule: { maxRuns: 12, deadline: '2027-01-07T05:00:00Z' }, actions: [], testedRoutes: ['route-claude-cli'], reviewOn: null, missedRun: 'run-once-on-wake',
  runsOn: 'this-computer', runs: 1, lastRunAt: null, nextRunAt: '2026-10-19T05:00:00Z', untrustedInstructions: false, digest: 'jd-1', revision: 1,
};
const row = { id: 'job_1', goal: card.goal, state: 'waiting', reason: 'waiting-for-you', nextRunAt: '2026-10-19T05:00:00Z', resumesAt: null, spent: { minor: '1200' }, budget: { minor: '2000' }, can: ['pause', 'cancel'] };
const EDIT = { id: 'jobsx_proposal_edit_1', title: 'Weekly close', origin: 'edit', replacesJobId: 'job_1', evidence: [], digest: 'c'.repeat(64) };
const JOBS = (items: unknown[] = []) => () => ({ items: [row], active: 1, limit: 10, proposals: { available: true, items } });
const lane = {
  title: 'Weekly close', state: 'waiting-for-you', reason: null,
  steps: [{ kind: 'calculate', title: 'Net sales for the week', needsModel: false }, { kind: 'lookup', title: 'Look up a missing detail with the agent', needsModel: true }],
  questions: [{ id: 'jobsx_question_1', prompt: 'Invoice INV-7 is long overdue. Remind, stop or call?', options: ['remind', 'stop', 'call'], askedAt: '2026-10-12T05:00:00Z' }],
  missed: { text: '3 runs were missed while this computer slept. Ran once.', at: '2026-10-12T04:00:00Z' }, leftUndone: [],
};
const sheet = (extra: Record<string, unknown> = {}) => ({
  ...card, result: null, timeline: [{ at: '2026-10-12T04:58:00Z', event: 'Worked out net sales for the week.', amount: null, needsModel: false, reason: null }],
  measure: null, schedule: { kind: 'interval', everyDays: 7, everyMs: 7 * 86_400_000 },
  meters: { model: { spent: { minor: '1200' }, budget: { minor: '2000' }, route: 'route-claude-cli', estimate: true }, clock: { minutes: 3 }, exposure: { minor: '0' } },
  missedRule: { rule: 'run-once-on-wake', choices: ['run-once-on-wake', 'skip', 'run-all'], runAll: 'offered' },
  manage: { edit: 'jobsx', delete: 'jobsx', missedRule: 'jobsx', personStep: 'jobsx' }, jobsx: lane, ...extra,
});

test('a job run by job extensions shows its steps with the model mark, its question and its missed-run note', async () => {
  show({ 'approvals.jobs': JOBS(), 'approvals.job': () => sheet() });
  const steps = await screen.findByText('Its steps');
  const block = steps.closest('[data-job-steps]') as HTMLElement;
  expect(within(block).getByText('Net sales for the week')).toBeTruthy();
  expect(within(block).getByText('runs without one')).toBeTruthy();
  expect(within(block).getByText('needs an AI model')).toBeTruthy();
  // WK-08: the question is the top row of the time line ("waiting for you").
  const timeline = screen.getByText('Time line').parentElement as HTMLElement;
  const q = within(timeline).getAllByRole('listitem')[0];
  expect(q.getAttribute('data-job-question')).toBe('jobsx_question_1');
  expect(within(q).getByText('Invoice INV-7 is long overdue. Remind, stop or call?')).toBeTruthy();
  expect(within(q).getByText(/Answers: remind, stop, call/)).toBeTruthy();
  expect(screen.getByText(/3 runs were missed while this computer slept\. Ran once\./)).toBeTruthy();
  expect(screen.getByText('₹12 of ₹20, on the route route-claude-cli (estimate)')).toBeTruthy(); // jobs-ext's measured budget
});

test('the missed-run rule offers run every missed one, applies at once, and MISSED_RULE_UNSUITABLE reads as a sentence', async () => {
  let calls = 0;
  const { rpc } = show({ 'approvals.jobs': JOBS(), 'approvals.job': () => sheet(),
    'approvals.setMissedRule': p => { calls += 1; if (calls === 1) throw refuse('MISSED_RULE_UNSUITABLE'); return { id: 'job:job_1', missedRun: p.rule, via: 'jobsx', waitsForApproval: false }; } });
  const form = await screen.findByRole('form', { name: 'Change the missed-run rule' });
  await userEvent.click(within(form).getByRole('radio', { name: 'run every missed one (up to 7, one after another)' }));
  await userEvent.click(within(form).getByRole('button', { name: 'Save the rule' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.setMissedRule', { id: 'job_1', rule: 'run-all' }));
  expect((await within(form).findByRole('alert')).textContent).toBe('This job works in daily rounds, so missed rounds cannot all be caught up on one day. Choose skip or run once on wake.');
  expect(within(form).queryByText(/MISSED_RULE_UNSUITABLE/)).toBeNull();
  await userEvent.click(within(form).getByRole('button', { name: 'Save the rule' }));
  expect(await within(form).findByText('Changed. The new rule applies from the next missed run.')).toBeTruthy();
});

test('daily rounds: run every missed one is not offered, and the sheet says why (Hindi too)', async () => {
  show({ 'approvals.jobs': JOBS(), 'approvals.job': () => sheet({ missedRule: { rule: 'skip', choices: ['run-once-on-wake', 'skip'], runAll: 'unsuitable' } }) });
  const form = await screen.findByRole('form', { name: 'Change the missed-run rule' });
  expect(within(form).queryByRole('radio', { name: /run every missed one/ })).toBeNull();
  expect((within(form).getByRole('radio', { name: 'skip it' }) as HTMLInputElement).checked).toBe(true);
  expect(within(form).getByText(/missed rounds cannot all be caught up on one day/)).toBeTruthy();
  cleanup();
  show({ 'approvals.jobs': JOBS(), 'approvals.job': () => sheet({ missedRule: { rule: 'skip', choices: ['run-once-on-wake', 'skip'], runAll: 'unsuitable' } }) }, { language: 'hi' });
  expect(await screen.findByText(/छूटे दौर एक ही दिन में पूरे नहीं किए जा सकते/)).toBeTruthy();
});

test('Edit through job extensions proposes a new card: no most-runs field, and the edit waits with the proposed jobs', async () => {
  let proposed = false;
  const { rpc } = show({ 'approvals.jobs': () => JOBS(proposed ? [EDIT] : [])(), 'approvals.job': () => sheet(),
    'approvals.editJob': () => { proposed = true; return { id: 'job:job_1', via: 'jobsx', waitsFor: 'proposal', proposal: { id: EDIT.id, digest: EDIT.digest } }; } });
  await userEvent.click(await screen.findByRole('button', { name: 'Edit the job' }));
  const form = screen.getByRole('form', { name: 'Edit' });
  expect(within(form).queryByLabelText('Most runs (1 to 366)')).toBeNull();
  const budget = within(form).getByLabelText('Budget in rupees'); await userEvent.clear(budget); await userEvent.type(budget, '30');
  await userEvent.click(within(form).getByRole('radio', { name: 'run every missed one (up to 7, one after another)' }));
  await userEvent.click(within(form).getByRole('button', { name: 'Save the change' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.editJob', { id: 'job_1', config: { budgetMinor: '3000', missedRun: 'run-all' } }));
  expect(await within(form).findByRole('status')).toBeTruthy();
  expect(within(form).getByRole('status').textContent).toMatch(/new card for this job\. It waits for your yes with the proposed jobs/);
  // The list reloads with the proposed edit; the job's sheet says an edit of it waits.
  const list = await screen.findByText('Proposed jobs waiting for your yes');
  const block = list.closest('[data-job-proposals]') as HTMLElement;
  expect(within(block).getByText('Weekly close')).toBeTruthy();
  expect(within(block).getByText('An edit of a job you have')).toBeTruthy();
  expect(await screen.findByText('An edit of this job waits for your yes with the proposed jobs.')).toBeTruthy();
});

test('a bad proposal row fails the list with INVALID_REPLY', async () => {
  show({ 'approvals.jobs': JOBS([{ ...EDIT, digest: '' }]), 'approvals.job': () => sheet() });
  expect((await screen.findAllByText(/INVALID_REPLY/)).length).toBeGreaterThan(0);
});
