import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language, View } from '../../app/ui/src/app/presentation';
import { jobsExtPlaces } from '../../app/ui/src/places/lane-jobs-ext';

// Every reply here is synthetic and shaped by platform/runtime/jobs-ext/methods.ts.
type Handler = (payload: Record<string, unknown>) => unknown;
const refuse = (code: string) => Object.assign(new Error(code), { code });
function fakeRpc(handlers: Record<string, Handler>) {
  return { request: vi.fn(async (method: string, payload: Record<string, unknown>) => { const h = handlers[method]; if (!h) throw refuse('UNKNOWN_METHOD'); return h(payload); }) };
}
const place = jobsExtPlaces[0]!;
function Harness({ rpc, start, language, viewer, view, onNavigate }: { rpc: ReturnType<typeof fakeRpc>; start: Address; language: Language; viewer: boolean; view: View; onNavigate: (a: Address | null) => void }) {
  const [address] = useState<Address>(start);
  return (
    <TextProvider language={language}>
      {place.render({ address, language, view, viewer, rpc, member: { id: 'm1', role: viewer ? 'viewer' : 'owner' }, live: () => true, openReceipt: () => {}, navigate: onNavigate })}
    </TextProvider>
  );
}
function show(handlers: Record<string, Handler>, opts: { language?: Language; viewer?: boolean; view?: View } = {}) {
  const rpc = fakeRpc(handlers); const onNavigate = vi.fn();
  render(<Harness rpc={rpc} start={{ place: 'work', sub: 'job-controls' }} language={opts.language ?? 'en'} viewer={opts.viewer ?? false} view={opts.view ?? 'guided'} onNavigate={onNavigate} />);
  return { rpc, onNavigate };
}
beforeEach(() => { vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const laneJob = { id: 'job_1', title: 'Chase unpaid invoices for a week', template: 'receivables-week', type: 'jobsx-receivables-week', goal: 'g', status: 'scheduled', state: 'scheduled',
  nextRunAt: '2026-10-16T09:00:00Z', spentMinor: '1250', spent: '₹12.50', budgetMinor: '5000', budget: '₹50.00', missed: null, laneRun: true, deleted: false };
const coreJob = { ...laneJob, id: 'job_2', title: 'Owner brief', template: null, type: 'owner-brief', laneRun: false };
const LIST = () => ({ proposals: [], jobs: [laneJob, coreJob], activeJobs: 1, activeJobCap: 10, atLimit: false });
const BUDGET = () => ({ jobId: 'job_1', budgetMinor: '123456789012', budget: 'x', spentMinor: '1250', spent: 'x', reservedMinor: '700', remainingMinor: '123456787062', remaining: 'x',
  meters: { model: [
    { routeId: 'gateway-claude', costMinor: '1250', cost: 'x', steps: 3, minutes: 2, basis: 'estimate' },
    { routeId: 'ollama-local', costMinor: '0', cost: 'x', steps: 5, minutes: 7, basis: 'zero' },
  ], clockMs: 185000, exposureMinor: '0', exposure: 'No money exposure: this job’s actions touch no money.' } });
let failures = 3;
const STOPS = () => ({ jobId: 'job_1', stoppedBy: null, setAside: null, rules: [
  { rule: 'runs', limit: 1, used: 0, met: false }, { rule: 'deadline', at: '2026-10-23T09:00:00Z', met: false },
  { rule: 'budget', budgetMinor: '5000', spentMinor: '1250', met: false }, { rule: 'failures', limit: failures, count: 1, met: false },
  { rule: 'goal', text: 'Seven daily rounds are done.', met: false }] });
const handlers = (extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  'jobsx.list': LIST, 'jobsx.budget': BUDGET, 'jobsx.stopRules': STOPS, 'jobsx.proposals': () => [], 'jobsx.missed': () => [],
  'jobsx.templateSkill': p => ({ path: `${String(p.id)}/SKILL.md`, content: '---\nname: chausar-receivables-week\n---\n\n# Chase unpaid invoices for a week\n' }), ...extra,
});
const openJob = async () => {
  const section = await waitFor(() => { const el = document.querySelector('[data-lane-jobs]'); expect(el?.querySelector('button')).toBeTruthy(); return el as HTMLElement; });
  await userEvent.click(within(section).getByRole('button', { name: /Chase unpaid invoices for a week/ }));
};
beforeEach(() => { failures = 3; });

test('loading, then only lane jobs, with spent of budget in exact rupees', async () => {
  let release: (v: unknown) => void = () => {};
  show(handlers({ 'jobsx.list': () => new Promise(resolve => { release = resolve; }) }));
  expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  release(LIST());
  const section = await waitFor(() => { expect(document.querySelector('[data-lane-jobs] li')).toBeTruthy(); return document.querySelector('[data-lane-jobs]') as HTMLElement; });
  expect(within(section!).getByText('Chase unpaid invoices for a week')).toBeTruthy();
  expect(within(section!).queryByText('Owner brief')).toBeNull();
  expect(within(section!).getByText('₹12.50 of ₹50 spent')).toBeTruthy();
});

test('budget meters are rupees from paise with estimate and priced-at-zero labels', async () => {
  const { rpc } = show(handlers());
  await openJob();
  const block = await waitFor(() => { const el = document.querySelector('[data-budget] dl'); expect(el).toBeTruthy(); return document.querySelector('[data-budget]') as HTMLElement; });
  expect(rpc.request).toHaveBeenCalledWith('jobsx.budget', { id: 'job_1' });
  expect(within(block).getByText('₹1,23,45,67,890.12')).toBeTruthy();
  expect(within(block).getByText('₹12.50')).toBeTruthy();
  expect(within(block).getByText('₹7')).toBeTruthy();
  expect(within(block).getByText('₹1,23,45,67,870.62')).toBeTruthy();
  expect(within(block).getByText('gateway-claude: ₹12.50 over 3 steps (estimate)')).toBeTruthy();
  expect(within(block).getByText('ollama-local: priced at zero, 7 minutes')).toBeTruthy();
  expect(within(block).getByText('3 minutes')).toBeTruthy();
  expect(within(block).getByText('None: this job’s actions touch no money.')).toBeTruthy();
});

test('stop rules: set aside after N failed runs is checked and sent to the engine', async () => {
  const { rpc } = show(handlers({ 'jobsx.setStopRules': p => { failures = p.failures as number; return STOPS(); } }));
  await openJob();
  expect(await screen.findByText('Set aside after 3 failed runs in a row. 1 now.')).toBeTruthy();
  expect(screen.getByText('Stops after 1 runs. 0 so far.')).toBeTruthy();
  expect(screen.getByText('Finished when: Seven daily rounds are done.')).toBeTruthy();
  const input = screen.getByLabelText(/Set aside after how many failed runs/);
  await userEvent.clear(input); await userEvent.type(input, '12');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Choose a whole number from 1 to 10.')).toBeTruthy();
  expect(rpc.request).not.toHaveBeenCalledWith('jobsx.setStopRules', expect.anything());
  await userEvent.clear(input); await userEvent.type(input, '5');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('jobsx.setStopRules', { id: 'job_1', failures: 5 }));
  expect(await screen.findByText('Saved.')).toBeTruthy();
  expect(await screen.findByText('Set aside after 5 failed runs in a row. 1 now.')).toBeTruthy();
});

test('Export as SKILL.md shows the file as text with Copy and Save, and sends nothing', async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const { rpc } = show(handlers());
  await openJob();
  await userEvent.click(await screen.findByRole('button', { name: 'Show SKILL.md' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('jobsx.templateSkill', { id: 'receivables-week' }));
  expect(await screen.findByText('File: receivables-week/SKILL.md')).toBeTruthy();
  expect((document.querySelector('[data-skill-content]') as HTMLElement).textContent).toContain('name: chausar-receivables-week');
  await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('# Chase unpaid invoices for a week'));
  expect(await screen.findByText('Copied.')).toBeTruthy();
});

test('Find repeating work runs detect, then lists the proposals waiting', async () => {
  let detected = false;
  const proposal = { id: 'proposal_1', origin: 'detector', template: 'cash-position', card: { title: 'Cash position every morning' }, evidence: ['You asked about money received in three different weeks.'], digest: 'd', status: 'proposed' };
  const { rpc, onNavigate } = show(handlers({ 'jobsx.detect': () => { detected = true; return [proposal]; }, 'jobsx.proposals': () => (detected ? [proposal] : []) }));
  expect(await screen.findByText('No proposals waiting.')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Find repeating work' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('jobsx.detect', {}));
  expect(await screen.findByText('Found one new proposal.')).toBeTruthy();
  expect(await screen.findByText('Cash position every morning')).toBeTruthy();
  expect(screen.getByText('Found by Chausar · You asked about money received in three different weeks.')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Review in Approvals' }));
  expect(onNavigate).toHaveBeenCalledWith({ place: 'work', sub: 'approvals' });
});

test('missed-run notes: Mark as read sends the unread ids', async () => {
  let seen = false;
  const notes = () => [
    { id: 'missed_1', jobId: 'job_1', at: '2026-10-14T09:00:00Z', missed: 2, ran: 1, rule: 'once', text: 'x', seen },
    { id: 'missed_0', jobId: 'job_1', at: '2026-10-10T09:00:00Z', missed: 1, ran: 0, rule: 'skip', text: 'x', seen: true },
  ];
  const { rpc } = show(handlers({ 'jobsx.missed': notes, 'jobsx.missed.seen': p => { seen = true; return { seen: (p.ids as string[]).length }; } }));
  expect(await screen.findByText('2 runs were missed while this computer slept. Ran once on waking, by the job’s rule.')).toBeTruthy();
  expect(screen.queryByText(/Skipped by the job’s rule/)).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('jobsx.missed.seen', { ids: ['missed_1'] }));
  expect(await screen.findByText('One note marked as read.')).toBeTruthy();
  expect(await screen.findByText('No unread notes about missed runs.')).toBeTruthy();
});

test('not built: UNKNOWN_METHOD on the list draws not built; a section without its method says so alone', async () => {
  show({});
  expect(await screen.findByText(/not built yet/i)).toBeTruthy();
  cleanup();
  show({ 'jobsx.list': LIST, 'jobsx.proposals': () => [], 'jobsx.missed': () => [] });
  await openJob();
  await waitFor(() => expect(document.querySelectorAll('[data-budget] p, [data-stop-rules] p').length).toBeGreaterThan(0));
  expect(within(document.querySelector('[data-budget]') as HTMLElement).getByText(/not built yet/i)).toBeTruthy();
  cleanup();
  show(handlers({ 'jobsx.list': () => ({ jobs: [{ ...laneJob, spentMinor: 12.5 }] }) }));
  expect(await screen.findByText(/INVALID_REPLY/)).toBeTruthy();
});

test('empty and viewer: no lane jobs says so; a viewer gets no Find, Save or Mark as read', async () => {
  show(handlers({ 'jobsx.list': () => ({ jobs: [coreJob] }) }));
  expect(await screen.findByText('No jobs run by job extensions yet.')).toBeTruthy();
  cleanup();
  show(handlers({ 'jobsx.missed': () => [{ id: 'missed_1', jobId: 'job_1', at: '2026-10-14T09:00:00Z', missed: 1, ran: 0, rule: 'skip', text: 'x', seen: false }] }), { viewer: true });
  expect(await screen.findByText('Your seat can read this but not change it.')).toBeTruthy();
  await screen.findByText(/One run was missed/);
  await openJob();
  await screen.findByText('Set aside after 3 failed runs in a row. 1 now.');
  for (const name of ['Find repeating work', 'Mark as read', 'Save']) expect(screen.queryByRole('button', { name })).toBeNull();
  expect(screen.getByRole('button', { name: 'Show SKILL.md' })).toBeTruthy();
});

test('Hindi', async () => {
  show(handlers(), { language: 'hi' });
  expect(await screen.findByRole('heading', { name: /जॉब नियंत्रण/ })).toBeTruthy();
  expect(await screen.findByText('₹50 में से ₹12.50 ख़र्च')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'दोहराया काम ढूँढें' })).toBeTruthy();
  await openJob();
  expect(await screen.findByText('gateway-claude: 3 क़दमों में ₹12.50 (अनुमान)')).toBeTruthy();
  expect(screen.getByText('लगातार 3 रन नाकाम होने पर अलग रखा जाता है। अभी 1।')).toBeTruthy();
});
