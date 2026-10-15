import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language, View } from '../../app/ui/src/app/presentation';
import { jobsExtPlaces } from '../../app/ui/src/places/lane-jobs-ext';

// Every reply here is synthetic and shaped by platform/runtime/procedures/methods.ts and jobs-ext/methods.ts.
type Handler = (payload: Record<string, unknown>) => unknown;
const refuse = (code: string) => Object.assign(new Error(code), { code });
function fakeRpc(handlers: Record<string, Handler>) {
  return { request: vi.fn(async (method: string, payload: Record<string, unknown>) => { const h = handlers[method]; if (!h) throw refuse('UNKNOWN_METHOD'); return h(payload); }) };
}
const place = jobsExtPlaces[0]!;
function Harness({ rpc, start, language, viewer, view, role }: { rpc: ReturnType<typeof fakeRpc>; start: Address; language: Language; viewer: boolean; view: View; role?: string }) {
  const [address, setAddress] = useState<Address>(start);
  return (
    <TextProvider language={language}>
      {place.render({ address, language, view, viewer, rpc, member: { id: 'm1', role: role ?? (viewer ? 'viewer' : 'owner') }, live: () => true, openReceipt: () => {},
        navigate: next => setAddress(next ?? start) })}
    </TextProvider>
  );
}
function show(handlers: Record<string, Handler>, opts: { language?: Language; viewer?: boolean; view?: View; role?: string } = {}) {
  const rpc = fakeRpc(handlers);
  render(<Harness rpc={rpc} start={{ place: 'work', sub: 'procedures' }} language={opts.language ?? 'en'} viewer={opts.viewer ?? false} view={opts.view ?? 'guided'} role={opts.role} />);
  return { rpc };
}
const listed = async () => { await waitFor(() => expect(document.querySelector('[data-procedure-list]')).toBeTruthy()); return document.querySelector('[data-procedure-list]') as HTMLElement; };
const openRow = async () => userEvent.click(within(await listed()).getByRole('button', { name: /Chase unpaid invoices for a week/ }));
beforeEach(() => { vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const D1 = 'a'.repeat(64), D2 = 'b'.repeat(64);
const steps = [
  { kind: 'calculate', title: 'Work out what each customer owes', operation: 'aging' },
  { kind: 'question', title: 'Decide for each invoice', id: 'decide', options: ['remind', 'wait'], rule: { feature: 'days_overdue', threshold: 0.8, minSupport: 2,
    buckets: [{ when: { min: 30, max: 90 }, option: 'remind', confidence: 1, support: 3 }, { when: { equals: true }, option: 'wait', confidence: 0.75, support: 4 }] } },
  { kind: 'action', title: 'Prepare a reminder', connector: 'local', operation: 'reminder-draft', when: 'remind' },
  { kind: 'lookup', title: 'Look up a missing detail', tool: 'lookup.contact', routeId: 'route-1', units: 1 },
];
const stats = { agentRuns: 3, agentCostMinor: '300', agentLatencyMs: 10, routedCases: 4, fallbackCases: 1, routedCostMinor: '0', fallbackCostMinor: '123456', routedShare: { routed: 4, total: 5 } };
const proc = (extra: Record<string, unknown> = {}) => ({ id: 'procedure_1', template: 'receivables-week', version: 2, createdAt: '2026-10-01T09:00:00Z', ownerId: 'm1', status: 'proposed', steps,
  match: { days_overdue: 'number' }, derivedFrom: ['procrun_1'], digest: D1, sourceIds: ['s1'], ...extra });
const TYPES = () => ({ templates: [
  { id: 'receivables-week', title: 'Chase unpaid invoices for a week', available: true },
  { id: 'gst-matching', title: 'GST matching', available: false, code: 'TEMPLATE_NOT_BUILT' },
], activeJobs: 0, activeJobCap: 10 });
const run1 = { id: 'procrun_1', at: '2026-10-02T09:00:00Z', jobId: 'j1', template: 'receivables-week', caseId: 'case-7', route: 'agent', featureShape: {}, steps: [], costMinor: '100', latencyMs: 5, outcome: 'ok', decision: 'remind', note: 'Late by forty days.', sourceIds: [] };
const base = (p: ReturnType<typeof proc> = proc()): Record<string, Handler> => ({
  'procedures.list': () => ({ procedures: [{ ...p, stats }] }),
  'procedures.get': () => ({ procedure: p, stats, runs: [run1] }),
  'jobsx.types': TYPES,
});

test('loading, then the list with routed share and exact rupee costs', async () => {
  let release: (v: unknown) => void = () => {};
  const { rpc } = show({ ...base(), 'procedures.list': () => new Promise(resolve => { release = resolve; }) });
  expect(screen.getByRole('status').textContent).toBeTruthy();
  release({ procedures: [{ ...proc(), stats }] });
  expect(within(await listed()).getByText('Chase unpaid invoices for a week')).toBeTruthy();
  expect(screen.getByText(/Proposed · Version 2 · 4 of 5 cases routed/)).toBeTruthy();
  expect(screen.getByText('Routed cost ₹0. Fallback cost ₹1,234.56.')).toBeTruthy();
  expect(rpc.request).toHaveBeenCalledWith('procedures.list', {});
});

test('empty: no procedures says so and still offers the ready-made jobs', async () => {
  show({ ...base(), 'procedures.list': () => ({ procedures: [] }) });
  expect(await screen.findByText('No procedures yet. Propose one from a ready-made job below.')).toBeTruthy();
  expect(await screen.findByText('Not built yet: it needs a part of Chausar still being built.')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: /Propose a procedure/ }).length).toBe(1);
});

test('not built: UNKNOWN_METHOD draws the not-built state; a bad reply draws the error state', async () => {
  show({ 'jobsx.types': TYPES });
  expect(await screen.findByText(/not built yet/i)).toBeTruthy();
  cleanup();
  show({ ...base(), 'procedures.list': () => ({ procedures: [{ ...proc(), stats: { ...stats, routedCostMinor: 1.5 } }] }) });
  expect(await screen.findByText(/INVALID_REPLY/)).toBeTruthy();
});

test('the sheet shows typed steps, rule buckets and runs; Approve sends the exact digest', async () => {
  let approved: Record<string, unknown> | null = null;
  const { rpc } = show({ ...base(), 'procedures.approve': p => { approved = p; return proc({ status: 'approved' }); } });
  await openRow();
  const steps = await screen.findByText('Work out what each customer owes');
  expect(steps).toBeTruthy();
  expect(screen.getByText('Calculate · Runs the calculation aging.')).toBeTruthy();
  expect(screen.getByText('Action · Waits for your yes, unless you let this kind run on its own in Trust.')).toBeTruthy();
  expect(screen.getByText('Lookup · Needs an AI model.')).toBeTruthy();
  expect(screen.getByText('Question · Decided by the case detail days_overdue. Used only when at least 80% sure.')).toBeTruthy();
  expect(screen.getByText('Options: remind, wait')).toBeTruthy();
  expect(screen.getByText('When days_overdue is 30 to 90: remind. 100% sure, from 3 runs.')).toBeTruthy();
  expect(screen.getByText('When days_overdue is yes: wait. 75% sure, from 4 runs.')).toBeTruthy();
  expect(screen.getByText(/Agent · ₹1 · done · chose remind/)).toBeTruthy();
  expect(screen.getByText('The agent wrote: “Late by forty days.”')).toBeTruthy();
  expect(screen.getByText(`You approve exactly this version. Fingerprint: ${D1}`)).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('procedures.approve', { id: 'procedure_1', digest: D1 }));
  expect(approved).toEqual({ id: 'procedure_1', digest: D1 });
  expect(await screen.findByText('Approved. Cases that fit now run through it.')).toBeTruthy();
});

test('PREVIEW_CHANGED re-reads the card and says it changed; the next Approve sends the new digest', async () => {
  let current = proc();
  const { rpc } = show({
    ...base(), 'procedures.get': () => ({ procedure: current, stats, runs: [] }),
    'procedures.approve': p => { if (p.digest !== current.digest) throw refuse('PREVIEW_CHANGED'); return { ...current, status: 'approved' }; },
  });
  await openRow();
  await screen.findByText(`You approve exactly this version. Fingerprint: ${D1}`);
  current = proc({ digest: D2, version: 3 });
  await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
  expect(await screen.findByText('The procedure changed after you opened it. It is shown again; read it before you approve.')).toBeTruthy();
  expect(await screen.findByText(`You approve exactly this version. Fingerprint: ${D2}`)).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('procedures.approve', { id: 'procedure_1', digest: D2 }));
});

test('Reject asks for a reason from the fixed list; Retire on an approved one', async () => {
  const { rpc } = show({ ...base(), 'procedures.reject': () => proc({ status: 'rejected', reason: 'wrong-rule' }) });
  await openRow();
  await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));
  const group = screen.getByRole('group', { name: 'Why reject it?' });
  expect(within(group).getAllByRole('radio').map(r => (r as HTMLInputElement).value)).toEqual(['wrong-steps', 'wrong-rule', 'not-needed', 'other']);
  await userEvent.click(within(group).getByRole('radio', { name: 'The rule is wrong' }));
  await userEvent.click(screen.getByRole('button', { name: 'Reject it' }));
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('procedures.reject', { id: 'procedure_1', reason: 'wrong-rule' }));
  expect(await screen.findByText('Rejected.')).toBeTruthy();
  cleanup();
  const approved = proc({ status: 'approved' });
  const second = show({ ...base(approved), 'procedures.retire': () => ({ ...approved, status: 'retired' }) });
  await openRow();
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  await userEvent.click(await screen.findByRole('button', { name: 'Retire' }));
  await waitFor(() => expect(second.rpc.request).toHaveBeenCalledWith('procedures.retire', { id: 'procedure_1' }));
});

test('propose: a refusal is a plain sentence; success opens the new procedure', async () => {
  let calls = 0;
  const { rpc } = show({ ...base(), 'procedures.list': () => ({ procedures: [] }),
    'procedures.propose': () => { calls += 1; if (calls === 1) throw refuse('PROCEDURE_NOT_ENOUGH_RUNS'); if (calls === 2) throw refuse('PROCEDURE_NO_RULE'); return proc(); } });
  const button = await screen.findByRole('button', { name: 'Propose a procedure: Chase unpaid invoices for a week' });
  await userEvent.click(button);
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('procedures.propose', { template: 'receivables-week' }));
  expect(await screen.findByText('The job needs more finished agent runs before a procedure can be proposed.')).toBeTruthy();
  await userEvent.click(button);
  expect(await screen.findByText('No single case detail explains the agent’s choices well enough to make a rule.')).toBeTruthy();
  await userEvent.click(button);
  expect(await screen.findByText('Proposed. Open it to read the steps.')).toBeTruthy();
  await waitFor(() => expect(rpc.request).toHaveBeenCalledWith('procedures.get', { id: 'procedure_1' }));
});

test('a viewer reads the list and the sheet but gets no Propose, Approve, Reject or Retire', async () => {
  show(base(), { viewer: true });
  expect(await screen.findByText('Your seat can read this but not change it.')).toBeTruthy();
  await listed();
  expect(screen.queryByRole('button', { name: /Propose a procedure/ })).toBeNull();
  await openRow();
  await screen.findByText('Work out what each customer owes');
  for (const name of ['Approve', 'Reject', 'Retire']) expect(screen.queryByRole('button', { name })).toBeNull();
});

test('an accountant seat may propose but gets no Approve, Reject or Retire', async () => {
  show(base(), { role: 'accountant' });
  await listed();
  expect(screen.queryAllByRole('button', { name: /Propose a procedure/ }).length).toBeGreaterThan(0);
  await openRow();
  await screen.findByText('Work out what each customer owes');
  for (const name of ['Approve', 'Reject', 'Retire']) expect(screen.queryByRole('button', { name })).toBeNull();
});

test('Hindi and the Books table', async () => {
  show(base(), { language: 'hi', view: 'books' });
  expect(await screen.findByRole('heading', { name: /प्रक्रियाएँ/ })).toBeTruthy();
  const table = document.querySelector('[data-procedures-table]') as HTMLElement;
  await waitFor(() => expect(within(table).getByText('प्रस्तावित')).toBeTruthy());
  expect(within(table).getByText('₹1,234.56')).toBeTruthy();
  expect(within(table).getByText('4/5')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'प्रक्रिया सुझाएँ: Chase unpaid invoices for a week' })).toBeTruthy();
});
