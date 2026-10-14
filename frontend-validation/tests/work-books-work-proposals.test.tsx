import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language } from '../../app/ui/src/app/presentation';
import { workPlace } from '../../app/ui/src/screens/work/index';
import { idOf } from '../../app/ui/src/screens/work/contract';

// Every reply is synthetic and shaped by docs/lanes/work-books.md: a proposed card from job extensions
// waiting in the queue as `proposal:<id>`, a lane job's question (WK-08) and the exact result to accept (WK-10).
type Handler = (payload: Record<string, unknown>) => unknown;
const refuse = (code: string) => Object.assign(new Error(code), { code });
function fakeRpc(handlers: Record<string, Handler>) {
  return { request: vi.fn(async (method: string, payload: Record<string, unknown>) => { const h = handlers[method]; if (!h) throw refuse('UNKNOWN_METHOD'); return h(payload); }) };
}
let current: Address = { place: 'work' };
function Harness({ rpc, start, language, role }: { rpc: ReturnType<typeof fakeRpc>; start: Address; language: Language; role: string }) {
  const [address, setAddress] = useState<Address>(start);
  current = address;
  return (
    <TextProvider language={language}>
      {workPlace.render({ address, language, view: 'guided', viewer: role === 'viewer', rpc, member: { id: 'member-1', role }, live: () => true, openReceipt: () => {},
        navigate: next => setAddress(next ?? { place: 'work', sub: address.sub ?? 'approvals' }) })}
    </TextProvider>
  );
}
function show(handlers: Record<string, Handler>, start: Address, opts: { language?: Language; role?: string } = {}) {
  const rpc = fakeRpc(handlers);
  render(<Harness rpc={rpc} start={start} language={opts.language ?? 'en'} role={opts.role ?? 'owner'} />);
  return { rpc };
}
beforeEach(() => { vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const NAMES = ['prepared', 'approved', 'done', 'read-back', 'recorded'] as const;
const AT = '2026-10-14T05:00:00Z';
const card = {
  id: 'jobsx_proposal_1', goal: 'Work out who owes you money and remind those who agreed.', doneWhen: 'Every overdue invoice is reminded, paid or asked about, and you accept the round.', owner: 'Owner',
  budget: { minor: '5000' }, reserve: { minor: '50' }, spent: { minor: '0' }, stopRule: { maxRuns: 12, deadline: '2027-01-06T05:00:00Z' }, actions: ['writeback.followUp'], testedRoutes: [],
  reviewOn: '2027-01-06', missedRun: 'run-once-on-wake', runsOn: 'this-computer', runs: 0, lastRunAt: null, nextRunAt: AT, untrustedInstructions: false, digest: 'd'.repeat(64), revision: 1,
};
const proposalItem = (state: 'prepared' | 'verified' = 'prepared') => ({
  id: 'proposal:jobsx_proposal_1', source: 'proposal', kind: 'job', tier: 'tier-2', title: 'Start job: Who owes you, every week', touches: 'writeback.followUp', amount: { minor: '5000' },
  preparedBy: { kind: 'person', name: 'Owner' }, createdAt: AT, expiresAt: null, state, practice: false,
  digest: 'd'.repeat(64), revision: 1, reason: 'job-approval',
  change: { fields: [{ name: 'goal', before: '', after: card.goal }, { name: 'step 1', before: '', after: 'Who owes and how late (runs without one)' }] },
  steps: NAMES.map((name, i) => ({ name, state: i === 0 || (state === 'verified' && i === 1) ? 'done' : i === 1 ? 'waiting-for-you' : 'not-reached', at: i === 0 ? AT : null })),
  can: state === 'prepared' ? ['approve', 'notNow', 'drop'] : [], readOnly: false, prepareOnly: false, needsSecondAsk: false, job: card,
  ...(state === 'verified' ? { approvedJobId: 'job:job_new' } : {}),
});
const LIST = { items: [proposalItem()], expired: [], snoozed: 0, counts: { tier2: 1, tier1: 0, prepareOnly: 0 } };

test('one sentence opens its proposal in the approval sheet; Approve sends its digest and offers the new job', async () => {
  const { rpc } = show({
    'approvals.jobs': () => ({ items: [], active: 0, limit: 10, proposals: { available: true, items: [] } }),
    'approvals.jobTemplates': () => ({ templates: [], fromSentence: { available: true } }),
    'approvals.proposeJob': () => ({ id: 'proposal:jobsx_proposal_1', proposal: { id: 'jobsx_proposal_1', digest: 'd'.repeat(64) } }),
    'approvals.list': () => LIST, 'approvals.get': () => proposalItem(), 'approvals.pace': () => ({ fastStreak: 0, warn: false }),
    'approvals.approve': () => proposalItem('verified'),
  }, { place: 'work', sub: 'jobs', sheet: 'start' });
  await userEvent.type(await screen.findByLabelText('Say the job in one sentence'), 'Tell me every Monday who owes me money.');
  await userEvent.click(screen.getByRole('button', { name: 'Propose from this sentence' }));
  await waitFor(() => expect(current.sub).toBe('approvals'));
  expect(idOf(current.sheet ?? '')).toBe('proposal:jobsx_proposal_1');
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.get', { id: 'proposal:jobsx_proposal_1' }));
  // The card of the proposed job (WK-09) is in the sheet.
  expect(await screen.findByText('Every overdue invoice is reminded, paid or asked about, and you accept the round.')).toBeTruthy();
  await userEvent.click(screen.getAllByRole('button', { name: 'Approve' })[0]);
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.approve', { id: 'proposal:jobsx_proposal_1', digest: 'd'.repeat(64) }));
  expect(await screen.findByText('Approved. The job runs within its budget and stop rule.')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Open the job' }));
  await waitFor(() => expect(current.sub).toBe('jobs'));
  expect(idOf(current.sheet ?? '')).toBe('job_new');
});

test('a proposal from job extensions on the Jobs page opens its approval; in Hindi too', async () => {
  const jobs = () => ({ items: [], active: 0, limit: 10, proposals: { available: true, items: [{ id: 'jobsx_proposal_1', title: 'Who owes you, every week', origin: 'person', replacesJobId: null, evidence: [], digest: 'd'.repeat(64) }] } });
  show({ 'approvals.jobs': jobs, 'approvals.list': () => LIST, 'approvals.get': () => proposalItem(), 'approvals.pace': () => ({ fastStreak: 0, warn: false }) }, { place: 'work', sub: 'jobs' });
  await userEvent.click(await screen.findByRole('button', { name: 'Open its approval' }));
  await waitFor(() => expect(idOf(current.sheet ?? '')).toBe('proposal:jobsx_proposal_1'));
  cleanup();
  show({ 'approvals.jobs': jobs }, { place: 'work', sub: 'jobs' }, { language: 'hi' });
  expect(await screen.findByRole('button', { name: 'इसकी मंज़ूरी खोलें' })).toBeTruthy();
});

const jobCard = { ...card, id: 'job_1', goal: 'Who owes you, every week', owner: 'Owner', spent: { minor: '1200' }, runs: 1, digest: 'j'.repeat(64) };
const row = (state: string, can: string[]) => ({ id: 'job_1', goal: jobCard.goal, state, reason: null, nextRunAt: null, resumesAt: null, spent: { minor: '1200' }, budget: { minor: '5000' }, can });
const laneJob = (questions: unknown[]) => ({
  title: 'Who owes you, every week', state: 'waiting-for-you', reason: null, steps: [], questions, missed: null, leftUndone: [],
});
const question = { id: 'jobsx_question_1', prompt: 'Invoice INV-7 is long overdue. Remind, stop or call?', options: ['remind', 'stop', 'call'], askedAt: AT, suggested: { option: 'call', percent: 50 } };
const sheet = (extra: Record<string, unknown> = {}) => ({
  ...jobCard, result: null, timeline: [{ at: AT, event: 'Worked out who owes what.', amount: null, needsModel: false, reason: null }], measure: null,
  schedule: { kind: 'interval', everyDays: 1, everyMs: 86_400_000 }, missedRule: { rule: 'run-once-on-wake', choices: ['run-once-on-wake', 'skip'], runAll: 'unsuitable' },
  manage: { edit: 'jobsx', delete: 'jobsx', missedRule: 'jobsx', personStep: 'jobsx', answer: 'jobsx', accept: 'jobsx' }, jobsx: laneJob([question]), acceptance: null, ...extra,
});
const JOBS = (state = 'waiting', can = ['pause', 'cancel']) => () => ({ items: [row(state, can)], active: 1, limit: 10, proposals: { available: true, items: [] } });

test('WK-08: the question leads the time line with the rule\'s pick; an answer is one of its options, sent to the engine', async () => {
  let asked = true;
  const { rpc } = show({ 'approvals.jobs': JOBS(), 'approvals.job': () => sheet({ jobsx: laneJob(asked ? [question] : []) }),
    'approvals.answerQuestion': p => { asked = false; return { jobId: 'job_1', questionId: p.questionId, answer: p.option, answeredAt: AT }; } }, { place: 'work', sub: 'jobs', sheet: 'job__1' });
  const timeline = (await screen.findByText('Time line')).parentElement as HTMLElement;
  const first = within(timeline).getAllByRole('listitem')[0];
  expect(within(first).getByText('Invoice INV-7 is long overdue. Remind, stop or call?')).toBeTruthy();
  expect(within(first).getByText(/^Waiting for you: the job asks/)).toBeTruthy();
  expect(within(first).getByText('The rule would pick “call”, 50% sure. You decide.')).toBeTruthy();
  const group = within(first).getByRole('group', { name: 'Answer with one of these' });
  expect(within(group).getAllByRole('button').map(b => b.textContent)).toEqual(['remind', 'stop', 'call']);
  await userEvent.click(within(group).getByRole('button', { name: 'stop' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.answerQuestion', { jobId: 'job_1', questionId: 'jobsx_question_1', option: 'stop' }));
});

test('a question that cannot be answered here says not built; a viewer sees the question but no answers (Hindi words)', async () => {
  show({ 'approvals.jobs': JOBS(), 'approvals.job': () => sheet({ manage: { edit: 'jobsx', delete: 'jobsx', missedRule: 'jobsx', personStep: 'jobsx', answer: 'not-built', accept: 'core' } }) }, { place: 'work', sub: 'jobs', sheet: 'job__1' });
  expect(await screen.findByText('Answering here arrives with job extensions. Not built yet.')).toBeTruthy();
  expect(screen.queryByRole('group', { name: 'Answer with one of these' })).toBeNull();
  cleanup();
  show({ 'approvals.jobs': JOBS(), 'approvals.job': () => sheet() }, { place: 'work', sub: 'jobs', sheet: 'job__1' }, { role: 'viewer', language: 'hi' });
  expect(await screen.findByText(/आपका इंतज़ार: जॉब पूछता है/)).toBeTruthy();
  expect(screen.getByText('नियम “call” चुनता, 50% पक्का। फ़ैसला आपका है।')).toBeTruthy();
  expect(screen.queryByRole('group')).toBeNull();
});

test('WK-10: Accept approves the exact result by its queue item and digest; Send back sends the sentence', async () => {
  const result = { done: ['Net sales worked out.'], open: [], receiptIds: [] };
  const { rpc } = show({ 'approvals.jobs': JOBS('awaiting-acceptance', ['accept', 'reject', 'cancel']), 'approvals.job': () => sheet({ jobsx: laneJob([]), result, acceptance: { id: 'acceptance:job_1', digest: 'a'.repeat(64) } }),
    'approvals.approve': () => ({ ...proposalItem('verified'), id: 'acceptance:job_1', source: 'acceptance' }),
    'approvals.sendBack': () => ({ id: 'job_1', state: 'rejected', via: 'jobsx' }) }, { place: 'work', sub: 'jobs', sheet: 'job__1' });
  await userEvent.click(await screen.findByRole('button', { name: 'Accept' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.approve', { id: 'acceptance:job_1', digest: 'a'.repeat(64) }));
  expect(rpc.request).not.toHaveBeenCalledWith('jobs.accept', expect.anything());
  await userEvent.type(screen.getByLabelText('Say in one sentence what is missing'), 'The margin is missing.');
  await userEvent.click(screen.getByRole('button', { name: 'Send back' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('approvals.sendBack', { id: 'job_1', reason: 'The margin is missing.' }));
  expect(await screen.findByText('Sent back. The job is paused until you resume it.')).toBeTruthy();
});

test('without the exact result reference there is no Accept, and the sheet says so', async () => {
  show({ 'approvals.jobs': JOBS('awaiting-acceptance', ['accept', 'reject']), 'approvals.job': () => sheet({ jobsx: laneJob([]), result: { done: ['x'], open: [], receiptIds: [] }, acceptance: null }) }, { place: 'work', sub: 'jobs', sheet: 'job__1' });
  expect(await screen.findByText('This result is not waiting for your acceptance any more. Reload the job.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
});

test('a proposal reply that breaks the contract (a bad id) fails with INVALID_REPLY', async () => {
  show({ 'approvals.jobs': () => ({ items: [], active: 0, limit: 10, proposals: { available: true, items: [] } }), 'approvals.jobTemplates': () => ({ templates: [], fromSentence: { available: true } }),
    'approvals.proposeJob': () => ({ id: 'jobsx_proposal_1' }) }, { place: 'work', sub: 'jobs', sheet: 'start' });
  await userEvent.type(await screen.findByLabelText('Say the job in one sentence'), 'Tell me every Monday who owes me money.');
  await userEvent.click(screen.getByRole('button', { name: 'Propose from this sentence' }));
  expect(await screen.findByText(/INVALID_REPLY/)).toBeTruthy();
  expect(current.sub).toBe('jobs');
});

// ---- Words: this lane's own fixed lines are said in the reader's language; data is shown as it came. ----

const acceptanceItem = {
  ...proposalItem(), id: 'acceptance:job_1', source: 'acceptance', title: 'Accept result: Close the week', what: { kind: 'accept-result', name: 'Close the week' }, reason: 'acceptance',
  change: { asWritten: 'The job delivered a result. Accepting it closes this run.', key: 'acceptance', fields: [{ name: 'goal', before: '', after: 'Close the week' }, { name: 'receipts', before: '', after: 'not shown here' }] },
};
const PACE = () => ({ fastStreak: 0, warn: false });

test('Hindi: a row named by its kind reads in Hindi, and the acceptance line and field names are words, not engine English', async () => {
  show({ 'approvals.list': () => ({ items: [{ ...proposalItem(), what: { kind: 'start-job', name: 'Who owes you, every week' } }], expired: [], snoozed: 0, counts: { tier2: 1, tier1: 0, prepareOnly: 0 } }),
    'approvals.get': () => acceptanceItem, 'approvals.pace': PACE }, { place: 'work', sub: 'approvals' }, { language: 'hi' });
  expect(await screen.findByText('जॉब शुरू करें: Who owes you, every week')).toBeTruthy();
  expect(screen.queryByText(/Start job:/)).toBeNull();
  cleanup();
  show({ 'approvals.list': () => LIST, 'approvals.get': () => acceptanceItem, 'approvals.pace': PACE },
    { place: 'work', sub: 'approvals', sheet: 'acceptance_cjob__1' }, { language: 'hi' });
  expect(await screen.findByText('जॉब ने नतीजा दिया। स्वीकार करने से यह रन पूरा होता है।')).toBeTruthy();
  expect(screen.getAllByText('नतीजा स्वीकार करें: Close the week').length).toBeGreaterThan(0);
  expect(screen.getByText('रसीदें')).toBeTruthy();
  expect(screen.getByText('यहाँ नहीं दिखाया गया')).toBeTruthy();
  expect(screen.queryByText(/delivered a result/)).toBeNull();
});

test('a row without a named kind keeps the engine title (another lane\'s data is never rewritten)', async () => {
  show({ 'approvals.list': () => ({ items: [{ ...proposalItem(), id: 'writeback:w1', source: 'writeback', title: 'Send a payment reminder' }], expired: [], snoozed: 0, counts: { tier2: 1, tier1: 0, prepareOnly: 0 } }) },
    { place: 'work', sub: 'approvals' }, { language: 'hi' });
  expect(await screen.findByText('Send a payment reminder')).toBeTruthy();
});

test('Hindi: after a restore the engine notes are said by their keys, with the deletions note; a note without a key is shown as it came', async () => {
  show({ 'approvals.afterRestore': () => ({ sendingClosed: true, items: [], notes: ['Sending stays closed until every action below is checked.', 'Some actions you cannot see are still being checked.'], noteKeys: ['closed-until-checked', 'hidden-being-checked'] }) },
    { place: 'work', sub: 'after-restore' }, { language: 'hi' });
  expect(await screen.findByText('जब तक नीचे की हर कार्रवाई जाँची न जाए, भेजना बंद रहता है।')).toBeTruthy();
  expect(screen.getByText('कुछ कार्रवाइयाँ जो आप नहीं देख सकते, अभी जाँची जा रही हैं।')).toBeTruthy();
  expect(screen.getByText(/बैकअप के बाद किए गए हटाने/)).toBeTruthy();
  expect(screen.queryByText(/Sending stays closed/)).toBeNull();
  cleanup();
  show({ 'approvals.afterRestore': () => ({ sendingClosed: false, items: [], notes: ['An older engine line.'] }) }, { place: 'work', sub: 'after-restore' });
  expect(await screen.findByText('An older engine line.')).toBeTruthy();
});

test('job reasons and core time-line events are words; a lane job\'s taint mark, next runs and recommendations show; Simple hides the meters', async () => {
  const core = { ...sheet({ jobsx: { ...laneJob([]), tainted: true, upcoming: ['2026-10-15T05:00:00Z', '2026-10-16T05:00:00Z'] }, result: { done: ['x'], open: [], recommends: ['Record each customer’s agreement to reminders when they give it.'], receiptIds: [] } }),
    timeline: [{ at: AT, event: 'catchup-skipped', amount: null, needsModel: null, reason: 'budget-exhausted' }],
    meters: { model: { spent: { minor: '0' }, budget: { minor: '5000' }, route: null, estimate: false }, clock: { missing: 'not-counted' }, exposure: { missing: 'not-counted' } } };
  show({ 'approvals.jobs': () => ({ items: [{ ...row('waiting', ['pause']), reason: 'waiting-for-you' }], active: 1, limit: 10, proposals: { available: true, items: [] } }), 'approvals.job': () => core }, { place: 'work', sub: 'jobs', sheet: 'job__1' });
  expect((await screen.findAllByText(/waiting for you/)).length).toBeGreaterThan(0);
  expect(screen.queryByText('waiting-for-you')).toBeNull();
  expect(await screen.findByText('A missed run was skipped')).toBeTruthy();
  expect(screen.getByText(/the budget ran out/)).toBeTruthy();
  expect(screen.getByText('This job read text from outside. Anything it would send waits for you.')).toBeTruthy();
  expect(screen.getByText('Next runs')).toBeTruthy();
  expect(screen.getByText('Record each customer’s agreement to reminders when they give it.')).toBeTruthy();
  expect(screen.getByText('The budget, as three meters')).toBeTruthy();
  cleanup();
  const rpc = fakeRpc({ 'approvals.jobs': () => ({ items: [row('waiting', ['pause'])], active: 1, limit: 10, proposals: { available: true, items: [] } }), 'approvals.job': () => core });
  render(<TextProvider language="en">{workPlace.render({ address: { place: 'work', sub: 'jobs', sheet: 'job__1' }, language: 'en', view: 'simple', viewer: false, rpc, member: { id: 'm', role: 'owner' }, live: () => true, openReceipt: () => {}, navigate: () => {} })}</TextProvider>);
  expect(await screen.findByText('Time line')).toBeTruthy();
  expect(screen.queryByText('The budget, as three meters')).toBeNull();
});
