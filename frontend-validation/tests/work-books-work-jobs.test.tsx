import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language } from '../../app/ui/src/app/presentation';
import { workPlace } from '../../app/ui/src/screens/work/index';
import { idOf } from '../../app/ui/src/screens/work/contract';
import { paiseToRupees, rupeesToPaise } from '../../app/ui/src/screens/work/StartJob';

// Every reply here is synthetic and shaped by docs/lanes/work-books.md.
type Handler = (payload: Record<string, unknown>) => unknown;
const refuse = (code: string) => Object.assign(new Error(code), { code });

function fakeRpc(handlers: Record<string, Handler>) {
  return {
    request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
      const handler = handlers[method];
      if (!handler) throw refuse('UNKNOWN_METHOD');
      return handler(payload);
    }),
  };
}

let current: Address = { place: 'work' };
function Harness({ rpc, start, language, role }: { rpc: ReturnType<typeof fakeRpc>; start: Address; language: Language; role: string }) {
  const [address, setAddress] = useState<Address>(start);
  current = address;
  return (
    <TextProvider language={language}>
      {workPlace.render({
        address, language, view: 'guided', viewer: role === 'viewer', rpc, member: { id: 'member-1', role },
        live: () => true, openReceipt: () => {},
        navigate: next => setAddress(next ?? (address.sub === undefined ? { place: 'work' } : { place: 'work', sub: address.sub })),
      })}
    </TextProvider>
  );
}
function show(handlers: Record<string, Handler>, start: Address, opts: { language?: Language; role?: string } = {}) {
  const rpc = fakeRpc(handlers);
  render(<Harness rpc={rpc} start={start} language={opts.language ?? 'en'} role={opts.role ?? 'owner'} />);
  return { rpc };
}

const TEMPLATES = {
  templates: [
    { id: 'daily-brief', title: 'Daily brief', goal: 'Write a short brief every day.', doneWhen: 'A brief is ready each day, and you accept it.', type: 'owner-brief', every: 'day', budget: { minor: '5000' }, maxRuns: 30, days: 30, missedRun: 'run-once-on-wake', actions: [], needsModel: false },
    { id: 'month-end-brief', title: 'Month-end brief', goal: 'Write a month-end brief.', doneWhen: 'A brief is ready each month, and you accept it.', type: 'owner-brief', every: 'month', budget: { minor: '20000' }, maxRuns: 12, days: 366, missedRun: 'skip', actions: [], needsModel: false },
  ],
  fromSentence: { available: false },
};
const NO_JOBS = () => ({ items: [], active: 0, limit: 10, proposals: { available: false } });
const NAMES = ['prepared', 'approved', 'done', 'read-back', 'recorded'] as const;
const card = {
  id: 'job_1', goal: 'Write a short brief every day.', doneWhen: 'When its owner accepts the result.', owner: 'Owner', budget: { minor: '5025' }, reserve: { minor: '5025' }, spent: { minor: '0' },
  stopRule: { maxRuns: 3, deadline: '2026-11-13T00:00:00Z' }, actions: [], testedRoutes: [], reviewOn: null, missedRun: 'skip',
  runsOn: 'this-computer', runs: 0, lastRunAt: null, nextRunAt: '2026-10-14T00:00:00Z', untrustedInstructions: false, digest: 'jd-1', revision: 1,
};
const approval = {
  id: 'job:job_1', source: 'job', kind: 'job', tier: 'tier-2', title: 'Start job: Write a short brief every day.', touches: null, amount: { minor: '5025' },
  preparedBy: { kind: 'person', name: 'Owner' }, createdAt: '2026-10-14T00:00:00Z', expiresAt: null, state: 'prepared', practice: false,
  digest: 'jd-1', revision: 1, reason: 'job-approval', change: { fields: [{ name: 'goal', before: '', after: 'Write a short brief every day.' }] },
  steps: NAMES.map((name, i) => ({ name, state: i === 0 ? 'done' : i === 1 ? 'waiting-for-you' : 'not-reached', at: i === 0 ? '2026-10-14T00:00:00Z' : null })),
  can: ['approve', 'notNow', 'change', 'drop'], readOnly: false, prepareOnly: false, needsSecondAsk: false, job: card,
};

beforeEach(() => {
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test('rupees typed as text become whole paise without floats', () => {
  expect(rupeesToPaise('50')).toBe('5000');
  expect(rupeesToPaise(' 50.25 ')).toBe('5025');
  expect(rupeesToPaise('50.5')).toBe('5050');
  expect(rupeesToPaise('0.07')).toBe('7');
  expect(rupeesToPaise('90071992547409.93')).toBe('9007199254740993');
  for (const bad of ['', '0', '0.00', '-5', '5.125', '1e3', '5,000', '.5', '5.', 'abc']) expect(rupeesToPaise(bad)).toBeNull();
  expect(paiseToRupees('5000')).toBe('50');
  expect(paiseToRupees('5025')).toBe('50.25');
  expect(paiseToRupees('7')).toBe('0.07');
});

test('Start a job lists the ready-made cards, proposes with paise and opens the approval sheet', async () => {
  const { rpc } = show({
    'approvals.jobs': NO_JOBS,
    'approvals.jobTemplates': () => TEMPLATES,
    'approvals.proposeJob': () => ({ id: 'job:job_1' }),
    'approvals.get': () => approval,
    'approvals.list': () => ({ items: [], expired: [], snoozed: 0, counts: { tier2: 0, tier1: 0, prepareOnly: 0 } }),
    'approvals.pace': () => ({ fastStreak: 0, warn: false }),
  }, { place: 'work', sub: 'jobs' });
  await userEvent.click(await screen.findByRole('button', { name: 'Start a job' }));
  expect(await screen.findByText('Start from a ready-made job')).toBeTruthy();
  const daily = document.querySelector('[data-template="daily-brief"]') as HTMLElement;
  expect(within(daily).getByText('A brief is ready each day, and you accept it.')).toBeTruthy();
  expect(within(daily).getByText('After 30 runs or 30 days, whichever comes first')).toBeTruthy();
  expect(within(daily).getByText('run once on wake')).toBeTruthy();
  expect(within(daily).getByText('none; it only reads your books')).toBeTruthy();
  expect(within(daily).getByText('runs without an AI model; runs on this computer')).toBeTruthy();
  expect(screen.getAllByText('Proposing a job from one sentence is not built yet.')).toHaveLength(2); // the page note and the sheet's section

  await userEvent.click(within(daily).getByRole('button', { name: 'Choose Daily brief' }));
  const budget = within(daily).getByLabelText('Budget in rupees') as HTMLInputElement;
  expect(budget.value).toBe('50');
  await userEvent.clear(budget); await userEvent.type(budget, '50.2.5');
  await userEvent.click(within(daily).getByRole('button', { name: 'Propose' }));
  expect(await within(daily).findByRole('alert')).toBeTruthy();
  expect(rpc.request).not.toHaveBeenCalledWith('approvals.proposeJob', expect.anything());

  await userEvent.clear(budget); await userEvent.type(budget, '50.25');
  const runs = within(daily).getByLabelText('Most runs (1 to 366)'); await userEvent.clear(runs); await userEvent.type(runs, '3');
  await userEvent.click(within(daily).getByRole('radio', { name: 'skip it' }));
  await userEvent.click(within(daily).getByRole('button', { name: 'Propose' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.proposeJob', { templateId: 'daily-brief', budgetMinor: '5025', maxRuns: 3, missedRun: 'skip' }));
  await waitFor(() => expect(current.sub).toBe('approvals'));
  expect(idOf(current.sheet ?? '')).toBe('job:job_1');
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.get', { id: 'job:job_1' }));
});

test('a refused proposal shows its code and stays on the sheet', async () => {
  show({
    'approvals.jobs': NO_JOBS, 'approvals.jobTemplates': () => TEMPLATES,
    'approvals.proposeJob': () => { throw refuse('ACTIVE_JOB_LIMIT'); },
  }, { place: 'work', sub: 'jobs', sheet: 'start' });
  await userEvent.click(await screen.findByRole('button', { name: 'Choose Month-end brief' }));
  await userEvent.click(screen.getByRole('button', { name: 'Propose' }));
  expect(await screen.findByText('Refused. Code ACTIVE_JOB_LIMIT.')).toBeTruthy();
  expect(current.sub).toBe('jobs');
});

test('one sentence is offered when installed and passes the sentence through', async () => {
  const { rpc } = show({
    'approvals.jobs': NO_JOBS, 'approvals.jobTemplates': () => ({ ...TEMPLATES, fromSentence: { available: true } }),
    'approvals.proposeJob': () => ({ id: 'job:job_2' }),
  }, { place: 'work', sub: 'jobs', sheet: 'start' });
  await userEvent.type(await screen.findByLabelText('Say the job in one sentence'), 'Tell me who owes money every Monday.');
  await userEvent.click(screen.getByRole('button', { name: 'Propose from this sentence' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.proposeJob', { sentence: 'Tell me who owes money every Monday.' }));
  await waitFor(() => expect(idOf(current.sheet ?? '')).toBe('job:job_2'));
});

test('a viewer and an accountant see no Start a job', async () => {
  for (const role of ['viewer', 'accountant']) {
    show({ 'approvals.jobs': NO_JOBS, 'approvals.jobTemplates': () => TEMPLATES }, { place: 'work', sub: 'jobs', sheet: 'start' }, { role });
    expect(await screen.findByText('No jobs yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start a job' })).toBeNull();
    expect(screen.queryByText('Start from a ready-made job')).toBeNull();
    cleanup();
  }
});

test('the job sheet shows three meters, with missing words for what is not counted', async () => {
  const row = { id: 'job_1', goal: card.goal, state: 'scheduled', reason: null, nextRunAt: null, resumesAt: null, spent: { minor: '0' }, budget: { minor: '5025' }, can: ['pause'] };
  show({
    'approvals.jobs': () => ({ items: [row], active: 1, limit: 10, proposals: { available: false } }),
    'approvals.job': () => ({ ...card, timeline: [], result: null, meters: { model: { spent: { minor: '0' }, budget: { minor: '5025' }, route: null, estimate: false }, clock: { missing: 'not-counted' }, exposure: { missing: 'not-counted' } } }),
  }, { place: 'work', sub: 'jobs', sheet: 'job_1' });
  expect(await screen.findByText('The budget, as three meters')).toBeTruthy();
  expect(screen.getByText('₹0 of ₹50.25; no model')).toBeTruthy();
  expect(screen.getAllByText('not counted')).toHaveLength(2);
  cleanup();
  show({
    'approvals.jobs': () => ({ items: [row], active: 1, limit: 10, proposals: { available: false } }),
    'approvals.job': () => ({ ...card, timeline: [], result: null, meters: { model: { spent: { minor: '1200' }, budget: { minor: '5025' }, route: 'codex-cli', estimate: true }, clock: { minutes: 3 }, exposure: { minor: '250000' } } }),
  }, { place: 'work', sub: 'jobs', sheet: 'job_1' }, { language: 'hi' });
  expect(await screen.findByText('बजट, तीन मीटर में')).toBeTruthy();
  expect(screen.getByText('3 मिनट')).toBeTruthy();
  expect(screen.getByText(/codex-cli/)).toBeTruthy();
  expect(screen.getByText(/अनुमान/)).toBeTruthy();
});

test('a meters field that breaks the contract fails the sheet with INVALID_REPLY', async () => {
  show({
    'approvals.jobs': NO_JOBS,
    'approvals.job': () => ({ ...card, timeline: [], result: null, meters: { model: { spent: { minor: '0' }, budget: { minor: '5025' }, route: null, estimate: false }, clock: { minutes: 1.5 }, exposure: { minor: '1' } } }),
  }, { place: 'work', sub: 'jobs', sheet: 'job_1' });
  expect(await screen.findByText(/INVALID_REPLY/)).toBeTruthy();
});
