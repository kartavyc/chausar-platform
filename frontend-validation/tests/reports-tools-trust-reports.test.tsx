import type { ReactElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language, View } from '../../app/ui/src/app/presentation';
import { placeModuleFor } from '../../app/ui/src/places/registry';
import type { PlaceRenderProps } from '../../app/ui/src/places/types';
import { reportsPlaces } from '../../app/ui/src/screens/reports/index';
import { changedFields } from '../../app/ui/src/screens/reports/Rhythm';

// Every reply below is a synthetic fixture shaped by section 1.1 of docs/lanes/reports-tools-trust.md.
afterEach(() => cleanup());

type Reply = unknown | ((payload: Record<string, unknown>) => unknown);
class Refusal extends Error { constructor(readonly code: string) { super(code); } }

const money = (exact: string, receiptId: string) => ({ kind: 'money', exact, receiptId, labels: [] });
const SHA = 'a'.repeat(64);

const PACKS = {
  checkedAt: '2026-10-12T09:00:00Z',
  packs: [
    { id: 'lender', title: 'Lender pack', gstModes: ['regular', 'composition'], pages: [
      { id: 'ready-for-loan', title: 'Ready for a loan?', state: 'ready-tested' },
      { id: 'ageing', title: 'Ageing', state: 'ready-untested' },
      { id: 'cash-plan', title: 'Cash plan', state: 'not-started', reason: 'Needs twelve months of books.' },
    ] },
    { id: 'ca', title: 'CA pack', gstModes: ['regular'], pages: [{ id: 'gstr-2b', title: 'Purchases against GSTR-2B', state: 'ready-tested' }] },
    { id: 'investor', title: 'Investor pack', gstModes: ['regular', 'composition', 'none'], pages: [] },
  ],
};

const PAGE = {
  pack: 'lender', page: 'ready-for-loan', title: 'Ready for a loan?', language: 'en', period: { from: '2026-04-01', to: '2026-09-30' },
  generatedAt: '2026-10-12T09:00:00Z', state: 'ready-tested',
  sections: [
    { id: 'balances', title: 'Balances', projection: false, gaps: ['Cash sales for August are not loaded.'], lines: [
      { id: 'bank', label: 'Bank', figure: money('1234500', 'rc-bank'), side: 'Dr' },
      { id: 'creditors', label: 'Creditors', figure: { kind: 'missing', missing: 'null' }, side: 'Cr' },
      { id: 'total', label: 'Net position', figure: money('900000', 'rc-total'), side: 'Dr' },
    ] },
    { id: 'next-quarter', title: 'Next quarter', projection: true, gaps: [], lines: [
      { id: 'cash-next', label: 'Cash in three months', figure: money('500000', 'rc-projection') },
    ] },
  ],
  notes: [
    { id: 'n43b', text: 'Section 43B(h) asks that small suppliers are paid within 45 days.', source: { title: 'Income Tax Act', url: 'https://incometaxindia.gov.in/43bh', checkedOn: '2026-09-30' }, notLegalAdvice: true },
    { id: 'ntreds', text: 'TReDS lets a buyer’s invoice be sold.', source: { title: 'Unsafe source', url: 'javascript:alert(1)', checkedOn: '2026-09-30' }, notLegalAdvice: true },
  ],
  disclaimer: 'This is not a loan offer or a promise of one.', gaps: ['Stock is counted once a year.'],
  markings: ['financial', 'confidential'], footer: { checkCode: 'CHK-7F3A', at: '2026-10-12T09:01:00Z' }, receiptIds: ['rc-bank', 'rc-total'],
};

const chart = (id: string) => [
  { id: `${id}-1`, label: 'Jul', figure: money('100000', `rc-${id}-1`) },
  { id: `${id}-2`, label: 'Aug', figure: { kind: 'missing', missing: 'not-loaded-yet' } },
  { id: `${id}-3`, label: 'Sep', figure: money('180000', `rc-${id}-3`) },
];
const WEEK = {
  id: 'wk-41', period: { from: '2026-10-12', to: '2026-10-18' }, scheduledFor: '2026-10-12T02:30:00Z', builtAt: '2026-10-12T05:10:00Z', late: true,
  changed: [{ id: 'c1', text: 'Sales rose', figure: money('180000', 'rc-sales'), chart: chart('sales') }],
  decide: [{ id: 'd1', text: 'Reorder rice' }], due: [{ id: 'u1', text: 'GSTR-3B for September', figure: { kind: 'missing', missing: 'not-counted' } }],
  inbox: [{ id: 'i1', text: 'Raise the price of oil?', reviewDate: '2026-10-16' }],
  missed: [{ id: 'm1', what: 'Daily closing for 10 October', at: '2026-10-10T13:30:00Z' }], explanation: 'not-written', receiptIds: ['rc-sales'],
};
const FRIDAY = {
  id: 'fr-41', period: { from: '2026-10-12', to: '2026-10-16' }, builtAt: '2026-10-16T11:00:00Z',
  decisions: [
    { id: 'dec1', text: 'Stopped credit to Ravi Traders', reviewDate: '2026-10-16', observed: 'Paid the old bill in full.', receiptIds: ['rc-ravi'] },
    { id: 'dec2', text: 'Moved Sunday hours', reviewDate: '2026-10-16', observed: null, receiptIds: [] },
  ],
  lessons: { available: true, items: Array.from({ length: 6 }, (_, i) => ({ id: `l${i}`, title: `Lesson ${i + 1}`, evidence: 3 + i, change: `Change ${i + 1}` })) },
};
const RHYTHM = {
  days: [1, 4], time: '08:30', dailyClosing: false, financialYearStart: '04-01', missedRule: 'run-late',
  mail: { on: false, address: null }, whatsapp: { on: false, phone: null }, mailVerified: false, whatsappVerified: false,
  whatsappTemplate: 'not-approved', previews: { mail: 'Subject: Your week ahead\nThree things changed.', whatsapp: 'Your week ahead is ready.' },
  testMode: true, relay: 'not-available',
};
const DUE = {
  caNote: 'Not yet checked by a CA.', table: { version: '2026.10', publishedAt: '2026-10-01' }, profile: { kind: 'retail', gstMode: 'regular', state: 'MH' },
  covered: true, coveredKinds: ['retail', 'wholesale'],
  rows: [
    { id: 'gstr3b-sep', what: 'GSTR-3B for September', dueOn: '2026-10-20', source: { title: 'GST portal', url: 'https://www.gst.gov.in/' }, lastChecked: '2026-10-01', checkOld: false, appliesTo: { kinds: ['retail'], gstModes: ['regular'], states: ['MH', 'KA'] } },
    { id: 'tds-q2', what: 'TDS return for Q2', dueOn: '2026-10-31', source: { title: 'Income Tax', url: 'http://insecure.example/' }, lastChecked: '2026-08-01', checkOld: true, appliesTo: { kinds: ['retail', 'wholesale'], gstModes: ['regular', 'composition'], states: ['MH'] } },
  ],
};
const RECORD = { id: 'ex-1', at: '2026-10-01T10:00:00Z', locked: false, encrypted: false, folder: '/exports/2026-10-01', stores: [{ name: 'ledger', rows: 12500, checkNumber: 'c0ffee12', file: 'ledger.csv' }] };
const EXPORTS = { warning: 'Exported files are not encrypted.', items: [RECORD] };

function fakeRpc(replies: Record<string, Reply>) {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const request = vi.fn(async (method: string, payload: Record<string, unknown>) => {
    calls.push({ method, payload });
    if (!(method in replies)) throw new Refusal('UNKNOWN_METHOD');
    const reply = replies[method];
    const value = typeof reply === 'function' ? (reply as (p: Record<string, unknown>) => unknown)(payload) : reply;
    if (value instanceof Refusal) throw value;
    return value;
  });
  return { rpc: { request }, calls, sent: (method: string) => calls.filter((c) => c.method === method) };
}

interface Mount { sub?: string; sheet?: string; language?: Language; view?: View; role?: string; viewer?: boolean; replies: Record<string, Reply> }
function mount({ sub, sheet, language = 'en', view = 'guided', role = 'owner', viewer = false, replies }: Mount) {
  const address: Address = { place: 'reports' };
  if (sub !== undefined) address.sub = sub;
  if (sheet !== undefined) address.sheet = sheet;
  const fake = fakeRpc(replies);
  const navigate = vi.fn(), openReceipt = vi.fn();
  const module = placeModuleFor(address, reportsPlaces);
  if (module === null) throw new Error('no module');
  const props: PlaceRenderProps = { address, language, view, viewer, member: { id: 'm1', role }, rpc: fake.rpc, live: () => true, openReceipt, navigate };
  const ui = (p: PlaceRenderProps): ReactElement => <TextProvider language={p.language}>{module.render(p)}</TextProvider>;
  const view_ = render(ui(props));
  return { ...fake, navigate, openReceipt, module, rerender: (next: Partial<PlaceRenderProps>) => view_.rerender(ui({ ...props, ...next })) };
}

const ALL = { 'reportsx.packs': PACKS, 'reportsx.page': PAGE, 'reportsx.weekAhead': WEEK, 'reportsx.friday': FRIDAY, 'reportsx.rhythm': RHYTHM, 'reportsx.due': DUE, 'reportsx.exports': EXPORTS };

test('every desktop and enterprise sub-place has a Reports module, and a bare address draws Packs', () => {
  const ids = (sub?: string) => placeModuleFor(sub === undefined ? { place: 'reports' } : { place: 'reports', sub }, reportsPlaces)?.id;
  expect(ids()).toBe('reports.packs');
  expect(ids('packs')).toBe('reports.packs');
  expect(ids('weekahead')).toBe('reports.weekahead');
  expect(ids('briefs')).toBe('reports.weekahead');
  expect(ids('duedates')).toBe('reports.duedates');
  expect(ids('exports')).toBe('reports.exports');
  expect(ids('sent')).toBe('reports.sent');
  expect(ids('handover')).toBeUndefined();
  expect(placeModuleFor({ place: 'tools', sub: 'packs' }, reportsPlaces)).toBeNull();
});

test('RP-01 packs: pages say their state in words, packs their GST modes, and a page opens as its sheet', async () => {
  const m = mount({ sub: 'packs', replies: ALL });
  expect(await screen.findByText('Lender pack')).toBeTruthy();
  expect(screen.getByText('Applies to GST: regular, composition')).toBeTruthy();
  expect(screen.getByText('Applies to GST: regular, composition, no GST')).toBeTruthy();
  expect(screen.getAllByText('Ready and tested').length).toBe(2);
  expect(screen.getByText('Ready, not tested yet')).toBeTruthy();
  expect(screen.getByText('Not started: Needs twelve months of books.')).toBeTruthy();
  expect(screen.getByText('This pack has no pages yet.')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: /Ready for a loan\?/ }));
  expect(m.navigate).toHaveBeenCalledWith({ place: 'reports', sub: 'packs', sheet: 'lender.ready-for-loan' });
  expect(m.sent('reportsx.packs')).toEqual([{ method: 'reportsx.packs', payload: {} }]);
});

test('RP-01 packs in Hindi', async () => {
  mount({ sub: 'packs', language: 'hi', replies: ALL });
  expect(await screen.findByText('Lender pack')).toBeTruthy();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('पैक');
  expect(screen.getByText('GST पर लागू: नियमित, कंपोज़िशन')).toBeTruthy();
  expect(screen.getByText('तैयार, अभी जाँचा नहीं गया')).toBeTruthy();
});

test('RP-02 a report page: figures open receipts, missing is words, Dr and Cr, gaps beside the total, projection apart, notes and footer', async () => {
  const m = mount({ sub: 'packs', sheet: 'lender.ready-for-loan', view: 'books', replies: ALL });
  const sheet = await screen.findByRole('region', { name: 'Ready for a loan?' });
  const page = within(sheet);
  expect(m.sent('reportsx.page')[0]?.payload).toEqual({ pack: 'lender', page: 'ready-for-loan', language: 'en' });
  await userEvent.click(page.getByTitle(/Opens receipt rc-bank$/));
  expect(m.openReceipt).toHaveBeenCalledWith('rc-bank');
  expect(page.getByText('not known')).toBeTruthy();
  const rows = page.getAllByRole('row');
  expect(rows[0]?.textContent).toContain('Dr');
  expect(rows[1]?.textContent).toContain('Cr');
  expect(rows[2]?.textContent).toContain('Gap: Cash sales for August are not loaded.');
  const projection = page.getByRole('region', { name: 'Projection' });
  expect(within(projection).getByText('Cash in three months')).toBeTruthy();
  expect(within(projection).getByText('projection')).toBeTruthy();
  const link = page.getByRole('link', { name: 'https://incometaxindia.gov.in/43bh' });
  expect(link.getAttribute('href')).toBe('https://incometaxindia.gov.in/43bh');
  expect(page.queryByRole('link', { name: 'javascript:alert(1)' })).toBeNull();
  expect(page.getByText('javascript:alert(1)')).toBeTruthy();
  expect(page.getAllByText('Not legal advice.').length).toBe(2);
  expect(page.getByText('This is not a loan offer or a promise of one.')).toBeTruthy();
  expect(page.getByText('Markings: Financial · Confidential')).toBeTruthy();
  expect(page.getByText('Check code CHK-7F3A')).toBeTruthy();
  expect(page.getByText('Recorded 12 Oct 2026, 09:01 UTC')).toBeTruthy();
  expect(page.getByText('Stock is counted once a year.')).toBeTruthy();
});

test('RP-02 language choice reads the page again in Hindi; Hindi words on the sheet', async () => {
  const m = mount({ sub: 'packs', sheet: 'lender.ready-for-loan', language: 'hi', replies: { ...ALL, 'reportsx.page': (p: Record<string, unknown>) => ({ ...PAGE, language: p['language'], title: p['language'] === 'hi' ? 'क्या ऋण के लिए तैयार?' : PAGE.title }) } });
  expect(await screen.findByRole('heading', { level: 3, name: 'क्या ऋण के लिए तैयार?' })).toBeTruthy();
  expect(m.sent('reportsx.page')[0]?.payload['language']).toBe('hi');
  expect(screen.getAllByText('नामे').length).toBe(2);
  expect(screen.getByText('यह अनुमान है, तथ्य नहीं। इसे ऊपर के तथ्यों से अलग रखा गया है।')).toBeTruthy();
  await userEvent.click(screen.getByRole('radio', { name: 'English' }));
  await waitFor(() => expect(m.sent('reportsx.page').at(-1)?.payload['language']).toBe('en'));
});

test('RP-02 export: a file shows its name, size and check number; PDF and Tally refusals are plain sentences; print uses the browser', async () => {
  const print = vi.spyOn(window, 'print').mockImplementation(() => {});
  const m = mount({ sub: 'packs', sheet: 'lender.ready-for-loan', replies: { ...ALL, 'reportsx.export': (p: Record<string, unknown>) =>
    p['format'] === 'pdf' ? new Refusal('PDF_USES_PRINT') : p['format'] === 'tally' ? new Refusal('TALLY_PAGE_EXPORT_NOT_AVAILABLE')
      : { format: p['format'], name: 'ready-for-loan.xlsx', path: '/out/ready-for-loan.xlsx', bytes: 20480, sha256: SHA, encrypted: false, textCellsProtected: true } } });
  await screen.findByRole('region', { name: 'Ready for a loan?' });
  await userEvent.click(screen.getByRole('button', { name: 'Export · Excel' }));
  expect(await screen.findByText('File made: ready-for-loan.xlsx')).toBeTruthy();
  expect(screen.getByText('Size: 20,480 bytes')).toBeTruthy();
  expect(screen.getByText(`Check number: ${SHA}`)).toBeTruthy();
  expect(m.sent('reportsx.export')).toEqual([{ method: 'reportsx.export', payload: { pack: 'lender', page: 'ready-for-loan', format: 'xlsx', language: 'en' } }]);
  await userEvent.click(screen.getByRole('button', { name: 'Export · PDF' }));
  expect(await screen.findByText('Use Print and choose Save as PDF.')).toBeTruthy();
  const prints = screen.getAllByRole('button', { name: 'Print' });
  expect(prints.length).toBe(2);
  await userEvent.click(prints[1]!);
  expect(print).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Export · File for Tally' }));
  expect(await screen.findByText('A file Tally can import is not available for a single report page yet.')).toBeTruthy();
  expect(m.sent('reportsx.export').length).toBe(3);
});

test('RP-02 viewer: can print, cannot export', async () => {
  mount({ sub: 'packs', sheet: 'lender.ready-for-loan', viewer: true, role: 'viewer', replies: ALL });
  await screen.findByRole('region', { name: 'Ready for a loan?' });
  expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Export/ })).toBeNull();
  expect(screen.getByText('Your seat can read and print this page, not export it.')).toBeTruthy();
});

test('RP-02 a sheet that is not a pack page says so and reads nothing', async () => {
  const m = mount({ sub: 'packs', sheet: 'nopack.page', replies: ALL });
  expect(await screen.findByText('This address is not a page of any pack.')).toBeTruthy();
  expect(m.sent('reportsx.page')).toEqual([]);
});

test('RP-03 the week ahead: three sections, a chart where a number moved, late with both times, inbox, missed, explanation', async () => {
  const m = mount({ sub: 'weekahead', replies: ALL });
  expect(await screen.findByText('What changed')).toBeTruthy();
  expect(screen.getByText('What needs a decision')).toBeTruthy();
  expect(screen.getByText('What is due')).toBeTruthy();
  expect(screen.getByRole('group', { name: 'How this number moved: Sales rose' })).toBeTruthy();
  await userEvent.click(screen.getByTitle(/Opens receipt rc-sales$/));
  expect(m.openReceipt).toHaveBeenCalledWith('rc-sales');
  expect(screen.getByText('not counted')).toBeTruthy();
  expect(screen.getByText('late')).toBeTruthy();
  expect(screen.getByText(/Due 12 Oct 2026, 02:30 UTC; made 12 Oct 2026, 05:10 UTC\./)).toBeTruthy();
  expect(screen.getByText('Raise the price of oil?')).toBeTruthy();
  expect(screen.getByText('Daily closing for 10 October')).toBeTruthy();
  expect(screen.getByText('The written explanation is a separate, optional step. It has not been written.')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Rhythm and delivery' }));
  expect(m.navigate).toHaveBeenCalledWith({ place: 'reports', sub: 'weekahead', sheet: 'rhythm' });
});

test('RP-03 and RP-04 in Hindi; the enterprise briefs sub-place draws the same page', async () => {
  mount({ sub: 'briefs', language: 'hi', replies: ALL });
  expect(await screen.findByText('क्या बदला')).toBeTruthy();
  expect(screen.getByText('देर से')).toBeTruthy();
  await userEvent.click(screen.getByRole('radio', { name: 'शुक्रवार' }));
  expect(await screen.findByText('समीक्षा के लिए देय फ़ैसले')).toBeTruthy();
  expect(screen.getByText('सबक़ों की मंज़ूरी काम · मंज़ूरियाँ में होती है।')).toBeTruthy();
});

test('RP-04 the Friday review: decisions with what was observed, at most five lessons with evidence and change', async () => {
  const m = mount({ sub: 'weekahead', replies: ALL });
  await screen.findByText('What changed');
  await userEvent.click(screen.getByRole('radio', { name: 'Friday' }));
  expect(await screen.findByText('Decisions due for review')).toBeTruthy();
  expect(m.sent('reportsx.friday')).toEqual([{ method: 'reportsx.friday', payload: {} }]);
  expect(screen.getByText('What was observed: Paid the old bill in full.')).toBeTruthy();
  expect(screen.getByText('Nothing observed yet.')).toBeTruthy();
  expect(screen.getByText('Lesson 5')).toBeTruthy();
  expect(screen.queryByText('Lesson 6')).toBeNull();
  expect(screen.getByText('Evidence: 3')).toBeTruthy();
  expect(screen.getByText('What it would change: Change 1')).toBeTruthy();
  expect(screen.getByText('Approving lessons happens in Work · Approvals.')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Receipt' }));
  expect(m.openReceipt).toHaveBeenCalledWith('rc-ravi');
});

test('RP-04 lessons not available yet say so', async () => {
  mount({ sub: 'weekahead', replies: { ...ALL, 'reportsx.friday': { ...FRIDAY, lessons: { available: false, items: [] } } } });
  await screen.findByText('What changed');
  await userEvent.click(screen.getByRole('radio', { name: 'Friday' }));
  expect(await screen.findByText('Proposed lessons are not available yet.')).toBeTruthy();
});

test('RP-05 rhythm: Save sends exactly reportsx.setRhythm with the changed fields, once', async () => {
  const m = mount({ sub: 'weekahead', sheet: 'rhythm', replies: { ...ALL, 'reportsx.setRhythm': (p: Record<string, unknown>) => ({ ...RHYTHM, ...p }) } });
  const sheet = await screen.findByRole('region', { name: 'Rhythm and delivery' });
  const s = within(sheet);
  expect(s.getByText('Sends only to the demo inbox and phone.')).toBeTruthy();
  expect(s.getAllByText('Nothing is sent until this is verified.').length).toBe(2);
  expect(s.getByText('Partial · The WhatsApp message template is not approved yet.')).toBeTruthy();
  expect(s.getByText(/Three things changed\./)).toBeTruthy();
  expect(s.getByText('Your week ahead is ready.')).toBeTruthy();
  expect((s.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  const time = s.getByLabelText('Time (HH:MM)');
  await userEvent.clear(time);
  await userEvent.type(time, '07:45');
  await userEvent.click(s.getByRole('button', { name: 'Fri' }));
  await userEvent.type(s.getByLabelText('Your phone number'), '+919800000000');
  await userEvent.click(s.getByRole('button', { name: 'Save' }));
  expect(await s.findByText('Saved.')).toBeTruthy();
  expect(m.sent('reportsx.setRhythm')).toEqual([{ method: 'reportsx.setRhythm', payload: { days: [1, 4, 5], time: '07:45', whatsapp: { on: false, phone: '+919800000000' } } }]);
});

test('RP-05 rhythm: a bad time is a sentence, not a request; Verify without the relay says so', async () => {
  const m = mount({ sub: 'weekahead', sheet: 'rhythm', replies: { ...ALL, 'reportsx.verifyChannel': () => new Refusal('RELAY_NOT_AVAILABLE') } });
  const sheet = await screen.findByRole('region', { name: 'Rhythm and delivery' });
  const s = within(sheet);
  const time = s.getByLabelText('Time (HH:MM)');
  await userEvent.clear(time);
  await userEvent.type(time, '25:00');
  await userEvent.click(s.getByRole('button', { name: 'Save' }));
  expect(s.getByText('Write the time as HH:MM, for example 08:30.')).toBeTruthy();
  expect(m.sent('reportsx.setRhythm')).toEqual([]);
  await userEvent.click(s.getAllByRole('button', { name: 'Verify' })[0]!);
  expect(await s.findByText('The relay is a paid, hosted part: planned, not available yet.', { selector: '[role=status]' })).toBeTruthy();
  expect(m.sent('reportsx.verifyChannel')).toEqual([{ method: 'reportsx.verifyChannel', payload: { channel: 'mail' } }]);
});

test('RP-05 rhythm is read only for an accountant and a viewer, in Hindi too', async () => {
  for (const [role, viewer] of [['accountant', false], ['viewer', true]] as const) {
    mount({ sub: 'weekahead', sheet: 'rhythm', role, viewer, language: 'hi', replies: ALL });
    const sheet = await screen.findByRole('region', { name: 'लय और भेजना' });
    expect(within(sheet).getByText('आपकी सीट ये सेटिंग पढ़ सकती है, बदल नहीं सकती।')).toBeTruthy();
    expect(within(sheet).getByText('सोम, गुरु')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'सहेजें' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'पुष्टि करें' })).toBeNull();
    cleanup();
  }
});

test('changedFields keeps only what differs', () => {
  const base = { days: [1, 4], time: '08:30', dailyClosing: false, financialYearStart: '04-01', missedRule: 'run-late' as const, mail: { on: false, address: null }, whatsapp: { on: false, phone: null } };
  expect(changedFields(base, { ...base, days: [4, 1] })).toEqual({});
  expect(changedFields(base, { ...base, dailyClosing: true, mail: { on: true, address: null } })).toEqual({ dailyClosing: true, mail: { on: true, address: null } });
});

test('RP-06 due dates: CA line, rows with source, last checked, what they apply to; profile saved by an admin', async () => {
  const m = mount({ sub: 'duedates', replies: { ...ALL, 'reportsx.setDueProfile': (p: Record<string, unknown>) => p } });
  expect(await screen.findByText('Not yet checked by a CA.')).toBeTruthy();
  expect(screen.getByText('GSTR-3B for September')).toBeTruthy();
  expect(screen.getByText('Due 20 Oct 2026')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'GST portal' }).getAttribute('href')).toBe('https://www.gst.gov.in/');
  expect(screen.queryByRole('link', { name: 'Income Tax' })).toBeNull();
  expect(screen.getByText('Checked more than 30 days ago.')).toBeTruthy();
  expect(screen.getByText('States: MH, KA')).toBeTruthy();
  expect(screen.getByText('GST modes: regular, composition')).toBeTruthy();
  const state = screen.getByLabelText('State (two letters)');
  await userEvent.clear(state);
  await userEvent.type(state, 'ka');
  await userEvent.click(screen.getByRole('radio', { name: 'composition' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Saved.')).toBeTruthy();
  expect(m.sent('reportsx.setDueProfile')).toEqual([{ method: 'reportsx.setDueProfile', payload: { kind: 'retail', gstMode: 'composition', state: 'KA' } }]);
  await waitFor(() => expect(m.sent('reportsx.due').length).toBe(2));
});

test('RP-06 a kind not covered says so with the covered list; an accountant reads the profile; Hindi', async () => {
  mount({ sub: 'duedates', role: 'accountant', language: 'hi', replies: { ...ALL, 'reportsx.due': { ...DUE, covered: false, profile: { kind: 'restaurant', gstMode: 'none', state: 'GJ' }, rows: [] } } });
  expect(await screen.findByText('अभी किसी CA ने नहीं जाँचा।')).toBeTruthy();
  expect(screen.getByText('इस तरह के व्यवसाय की नियत तारीख़ें अभी शामिल नहीं हैं।')).toBeTruthy();
  expect(screen.getByText('अभी शामिल: retail, wholesale')).toBeTruthy();
  expect(screen.getByText('restaurant · GST नहीं · GJ')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'सहेजें' })).toBeNull();
});

test('RP-07 exports: the warning and the locked choice come first, then a confirmation, then each store with rows and check number', async () => {
  const m = mount({ sub: 'exports', replies: { ...ALL, 'reportsx.exportAll': { ...RECORD, id: 'ex-2', at: '2026-10-14T08:00:00Z', locked: true, stores: [{ name: 'invoices', rows: 340, checkNumber: 'beef0042', file: 'invoices.csv' }] } } });
  expect(await screen.findByText('Exported files are not encrypted.', { selector: 'p' })).toBeTruthy();
  expect(screen.getByText('ledger')).toBeTruthy();
  expect(screen.getByText('12,500')).toBeTruthy();
  await userEvent.click(screen.getByRole('radio', { name: 'Yes' }));
  await userEvent.click(screen.getByRole('button', { name: 'Export everything' }));
  expect(m.sent('reportsx.exportAll')).toEqual([]);
  expect(screen.getByText('Export everything now? Every store is written to open files on this computer.')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Yes, export everything' }));
  expect(await screen.findByText('Export finished.')).toBeTruthy();
  expect(screen.getByText('invoices')).toBeTruthy();
  expect(screen.getByText('340')).toBeTruthy();
  expect(screen.getByText('beef0042')).toBeTruthy();
  expect(m.sent('reportsx.exportAll')).toEqual([{ method: 'reportsx.exportAll', payload: { confirmed: true, locked: true } }]);
});

test('RP-07 only the owner exports; others read the list; Hindi', async () => {
  for (const [role, viewer] of [['cofounder', false], ['viewer', true]] as const) {
    mount({ sub: 'exports', role, viewer, language: 'hi', replies: ALL });
    expect(await screen.findByText('सब कुछ केवल मालिक निर्यात कर सकते हैं। आप सूची पढ़ सकते हैं।')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'सब कुछ निर्यात करें' })).toBeNull();
    expect(screen.getByText('ledger')).toBeTruthy();
    cleanup();
  }
});

test('RP-08 ask a person: makes one file and says the app sends nothing', async () => {
  const m = mount({ sub: 'exports', sheet: 'ask-a-person', replies: { ...ALL, 'reportsx.askPerson': { file: { name: 'question-2026-10-14.chausar', path: '/q/question.chausar', bytes: 2048, sha256: SHA }, sent: false } } });
  const sheet = await screen.findByRole('region', { name: 'Ask a person' });
  const s = within(sheet);
  await userEvent.click(s.getByRole('button', { name: 'Make the file' }));
  expect(s.getByText('Write your question.')).toBeTruthy();
  await userEvent.type(s.getByLabelText('Your question'), 'Is this purchase claimable?');
  await userEvent.type(s.getByLabelText('Receipt id (optional)'), 'rc-bank');
  await userEvent.type(s.getByLabelText('Why you are asking'), 'Chausar said not yet.');
  await userEvent.click(s.getByRole('button', { name: 'Make the file' }));
  expect(await s.findByText('File: question-2026-10-14.chausar')).toBeTruthy();
  expect(s.getByText(`Check number: ${SHA}`)).toBeTruthy();
  expect(s.getAllByText('The app sends nothing by itself. Send this file to your accountant or CA yourself.').length).toBe(2);
  expect(m.sent('reportsx.askPerson')).toEqual([{ method: 'reportsx.askPerson', payload: { question: 'Is this purchase claimable?', reason: 'Chausar said not yet.', receiptId: 'rc-bank' } }]);
});

test('RP-08 from the exports page link; a viewer cannot make the file; Hindi', async () => {
  const m = mount({ sub: 'exports', replies: ALL });
  await screen.findByText('ledger');
  await userEvent.click(screen.getByRole('button', { name: 'Ask a person' }));
  expect(m.navigate).toHaveBeenCalledWith({ place: 'reports', sub: 'exports', sheet: 'ask-a-person' });
  cleanup();
  mount({ sub: 'exports', sheet: 'ask-a-person', viewer: true, role: 'viewer', language: 'hi', replies: ALL });
  const sheet = await screen.findByRole('region', { name: 'किसी व्यक्ति से पूछें' });
  expect(within(sheet).getByText('आपकी सीट सवाल की फ़ाइल नहीं बना सकती।')).toBeTruthy();
  expect(within(sheet).queryByRole('button', { name: 'फ़ाइल बनाएँ' })).toBeNull();
});

test('not built, failed and invalid replies draw the design states', async () => {
  mount({ sub: 'packs', replies: {} });
  expect(await screen.findByText('Not built yet.')).toBeTruthy();
  cleanup();
  mount({ sub: 'duedates', replies: { 'reportsx.due': () => new Refusal('DISK_FULL') } });
  expect(await screen.findByText('Code DISK_FULL')).toBeTruthy();
  cleanup();
  mount({ sub: 'weekahead', replies: { 'reportsx.weekAhead': { ...WEEK, changed: [{ id: 'c1', text: 'Sales rose', figure: { kind: 'money', exact: '12.5', receiptId: 'rc' } }] } } });
  expect(await screen.findByText('Code INVALID_REPLY')).toBeTruthy();
  cleanup();
  mount({ sub: 'exports', replies: { 'reportsx.exports': { warning: 'x', items: [{ ...RECORD, stores: [{ name: 'ledger', rows: -1, checkNumber: 'c', file: 'f' }] }] } } });
  expect(await screen.findByText('Code INVALID_REPLY')).toBeTruthy();
  cleanup();
  mount({ sub: 'sent', language: 'hi', replies: {} });
  expect(screen.getByText('अभी बना नहीं है।')).toBeTruthy();
});

test('every sub-place draws in Simple and Books', async () => {
  for (const view of ['simple', 'books'] as const) {
    for (const [sub, text] of [['packs', 'Lender pack'], ['weekahead', 'What changed'], ['duedates', 'GSTR-3B for September'], ['exports', 'ledger']] as const) {
      mount({ sub, view, replies: ALL });
      expect(await screen.findByText(text)).toBeTruthy();
      if (view === 'books' && sub === 'weekahead') expect(screen.getByText('Brief wk-41')).toBeTruthy();
      if (view === 'simple' && sub === 'duedates') expect(screen.queryByText(/^Table 2026\.10/)).toBeNull();
      cleanup();
    }
  }
});

test('a reply that is not a figure with a receipt never shows as an amount', async () => {
  mount({ sub: 'packs', sheet: 'lender.ready-for-loan', replies: { ...ALL, 'reportsx.page': { ...PAGE, sections: [{ ...PAGE.sections[0], lines: [{ id: 'x', label: 'Bank', figure: { kind: 'money', exact: '100', receiptId: '' } }] }] } } });
  expect(await screen.findByText('Code INVALID_REPLY')).toBeTruthy();
  await act(async () => {});
});
