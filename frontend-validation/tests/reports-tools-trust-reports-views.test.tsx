import type { ReactElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language, View } from '../../app/ui/src/app/presentation';
import { placeModuleFor } from '../../app/ui/src/places/registry';
import type { PlaceRenderProps } from '../../app/ui/src/places/types';
import { reportsPlaces } from '../../app/ui/src/screens/reports/index';

// Synthetic fixtures shaped by section 1.1 of docs/lanes/reports-tools-trust.md, with the round-2 additions:
// language on every reportsx read, movement and coverage on brief items, Hindi engine words, phone channels from
// hosted-link, Ask's saved answers as the receipt picker, and question files for an accountant seat.
afterEach(() => cleanup());

type Reply = unknown | ((payload: Record<string, unknown>) => unknown);
class Refusal extends Error { constructor(readonly code: string) { super(code); } }
const money = (exact: string, receiptId: string) => ({ kind: 'money', exact, receiptId, labels: [] });
const SHA = 'b'.repeat(64);

const PAGE = {
  pack: 'lender', page: 'key-financials', title: 'Key financials', language: 'en', period: { from: '2026-04-01', to: '2026-09-30' },
  generatedAt: '2026-10-12T09:00:00Z', state: 'ready-tested',
  sections: [{ id: 'operations', title: 'Operating figures', projection: false, gaps: [], lines: [
    { id: 'net-sales', label: 'Net sales', figure: money('25000000', 'rc-sales'), side: null },
    { id: 'receivables', label: 'Trade receivables', figure: { kind: 'missing', missing: 'withheld' }, side: 'Dr' },
  ] }],
  notes: [], disclaimer: null, gaps: [], markings: [], footer: { checkCode: 'CHK-1', at: '2026-10-12T09:01:00Z' }, receiptIds: ['rc-sales'],
};
const bars = (before: unknown, after: unknown) => [{ id: 'week-before', label: 'The week before', figure: before }, { id: 'last-week', label: 'Last week', figure: after }];
const WEEK = {
  id: 'wk-41', period: { from: '2026-10-12', to: '2026-10-18' }, scheduledFor: '2026-10-12T03:30:00Z', builtAt: '2026-10-12T03:31:00Z', late: false,
  changed: [
    { id: 'net_sales', text: 'Net sales, last week against the week before', figure: money('1250000000', 'rc-ns-2'), chart: bars(money('900000000', 'rc-ns-1'), money('1250000000', 'rc-ns-2')), movement: 'moved', coverage: 'partial' },
    { id: 'billed', text: 'Invoices raised, last week against the week before', figure: money('500000', 'rc-b-2'), chart: bars(money('500000', 'rc-b-1'), money('500000', 'rc-b-2')), movement: 'same', coverage: 'complete' },
    { id: 'received', text: 'Money received, last week against the week before', figure: money('300000', 'rc-r-2'), chart: bars({ kind: 'missing', missing: 'absent' }, money('300000', 'rc-r-2')), movement: 'not-enough', coverage: 'complete' },
  ],
  decide: [], due: [], inbox: [], missed: [], explanation: 'not-written', receiptIds: ['rc-ns-1', 'rc-ns-2'],
  gaps: ['Some figures are withheld: the data is marked financial and your seat does not see it.', 'Net sales: some records could not be counted, so this figure is partial.'],
};
const FRIDAY = {
  id: 'fr-41', period: { from: '2026-10-12', to: '2026-10-18' }, builtAt: '2026-10-16T11:00:00Z',
  decisions: [{ id: 'dec1', text: 'Stopped credit to a synthetic customer', reviewDate: '2026-10-16', observed: null, receiptIds: ['rc-dec'] }],
  lessons: { available: true, items: [{ id: 'l1', title: 'Remind on Tuesdays', evidence: 4, change: 'reminder-timing', changeText: 'When a reminder is sent' }] },
};
const RHYTHM = {
  days: [1], time: '09:00', dailyClosing: false, financialYearStart: '04-01', missedRule: 'run-late',
  mail: { on: false, address: null }, whatsapp: { on: false, phone: null }, mailVerified: false, whatsappVerified: false,
  whatsappTemplate: 'not-approved', previews: { mail: 'The week ahead is ready. Open Chausar to see it.', whatsapp: 'The week ahead is ready. Open Chausar to see it.' },
  testMode: false, relay: 'not-available',
};
const CHANNELS = {
  stale: true, refreshedAt: '2026-10-12T08:00:00Z', channels: [
    { channel: 'whatsapp', desktop: { enabled: true, optInAt: '2026-10-01T10:00:00Z' }, relay: { status: 'on', optInAt: '2026-10-01T10:00:00Z', address: null, connectUrl: null } },
    { channel: 'telegram', desktop: { enabled: false, optInAt: null }, relay: null },
    { channel: 'mail', desktop: { enabled: true, optInAt: '2026-10-02T10:00:00Z' }, relay: { status: 'awaiting-start', optInAt: null, address: 'owner@example.com', connectUrl: null } },
  ],
};
const SAVED = { items: [
  { id: 'sv1', kind: 'answer', question: 'Net sales in September', operationId: 'net_sales', savedAt: '2026-10-10T10:00:00.000Z', receiptId: 'rc-sep', refId: null, headline: { kind: 'money', minor: '100' }, workedOutAt: null, deletedOn: null, stale: null, rebuildable: true },
  { id: 'sv2', kind: 'answer', question: 'A withheld answer', operationId: 'net_sales', savedAt: '2026-10-09T10:00:00.000Z', receiptId: 'rc-hidden', refId: null, headline: null, workedOutAt: null, deletedOn: null, stale: null, rebuildable: true },
  { id: 'sv3', kind: 'answer', question: 'A deleted answer', operationId: 'net_sales', savedAt: '2026-10-08T10:00:00.000Z', receiptId: null, refId: null, headline: null, workedOutAt: null, deletedOn: '2026-10-09', stale: null, rebuildable: false },
] };
const ASKED = { file: { name: 'question-2026-10-14.html', path: '/q/question-2026-10-14.html', bytes: 900, sha256: SHA }, sent: false };
const QUESTIONS = { items: [{ name: 'question-2026-10-14T06-00-00-000Z.html', bytes: 900, at: '2026-10-14T06:00:00.000Z' }] };
const OPENED = { ...QUESTIONS.items[0], sha256: SHA, text: 'A question for my accountant\nQuestion\nIs <b>this</b> right?' };

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

interface Mount { sub: string; sheet?: string; language?: Language; view?: View; role?: string; viewer?: boolean; replies: Record<string, Reply> }
function mount({ sub, sheet, language = 'en', view = 'guided', role = 'owner', viewer = false, replies }: Mount) {
  const address: Address = { place: 'reports', sub };
  if (sheet !== undefined) address.sheet = sheet;
  const fake = fakeRpc(replies);
  const navigate = vi.fn(), openReceipt = vi.fn();
  const module = placeModuleFor(address, reportsPlaces);
  if (module === null) throw new Error('no module');
  const props: PlaceRenderProps = { address, language, view, viewer, member: { id: 'm1', role }, rpc: fake.rpc, live: () => true, openReceipt, navigate };
  const ui = (p: PlaceRenderProps): ReactElement => <TextProvider language={p.language}>{module.render(p)}</TextProvider>;
  render(ui(props));
  return { ...fake, navigate, openReceipt };
}

const ALL = {
  'reportsx.page': PAGE, 'reportsx.weekAhead': WEEK, 'reportsx.friday': FRIDAY, 'reportsx.rhythm': RHYTHM, 'phone.channels.list': CHANNELS,
  'reportsx.exports': { warning: 'Exported files are not encrypted.', items: [] }, 'askx.saved': SAVED, 'reportsx.askPerson': ASKED,
  'reportsx.questions': QUESTIONS, 'reportsx.openQuestion': OPENED,
};

test('RP-03 shows its gaps, "No change since Monday" without a chart, "Not enough to tell" with its action, and partial coverage', async () => {
  const m = mount({ sub: 'weekahead', replies: ALL });
  expect(await screen.findByText('What this brief cannot show')).toBeTruthy();
  expect(screen.getByText('Some figures are withheld: the data is marked financial and your seat does not see it.')).toBeTruthy();
  expect(screen.getByText('Net sales: some records could not be counted, so this figure is partial.')).toBeTruthy();
  expect(screen.getByText('No change since Monday.')).toBeTruthy();
  expect(screen.queryByRole('group', { name: 'How this number moved: Invoices raised, last week against the week before' })).toBeNull();
  expect(screen.getByRole('group', { name: 'How this number moved: Net sales, last week against the week before' })).toBeTruthy();
  expect(screen.getByText('Not enough loaded to tell: the week before has no records yet.')).toBeTruthy();
  expect(screen.getAllByText('Partly loaded: some records were not counted.').length).toBe(1);
  await userEvent.click(screen.getByRole('button', { name: 'Add a source' }));
  expect(m.navigate).toHaveBeenCalledWith({ place: 'books', sub: 'sources' });
  expect(m.sent('reportsx.weekAhead')).toEqual([{ method: 'reportsx.weekAhead', payload: { language: 'en' } }]);
});

test('RP-03 asks the engine for Hindi and draws its words; the screen words are Hindi too', async () => {
  const m = mount({ sub: 'weekahead', language: 'hi', replies: { ...ALL, 'reportsx.weekAhead': (p: Record<string, unknown>) => p['language'] === 'hi'
    ? { ...WEEK, changed: [{ ...WEEK.changed[1], text: 'जारी किए गए बिल, पिछला सप्ताह' }], gaps: ['कुछ आँकड़े रोके गए हैं: डेटा पर वित्तीय चिह्न है और आपकी सीट इसे नहीं देखती।'] } : WEEK } });
  expect(await screen.findByText('जारी किए गए बिल, पिछला सप्ताह')).toBeTruthy();
  expect(screen.getByText('सोमवार से कोई बदलाव नहीं।')).toBeTruthy();
  expect(screen.getByText('यह ब्रीफ़ क्या नहीं दिखा सकता')).toBeTruthy();
  expect(m.sent('reportsx.weekAhead')[0]?.payload).toEqual({ language: 'hi' });
});

test('Simple shows money in the short form with the exact value in the title; Guided and Books the full form', async () => {
  mount({ sub: 'weekahead', view: 'simple', replies: ALL });
  const short = await screen.findByRole('button', { name: '₹1.25 crore' });
  expect(short.getAttribute('title')).toContain('1250000000');
  expect(screen.getByRole('button', { name: '₹5,000' })).toBeTruthy();
  cleanup();
  mount({ sub: 'weekahead', view: 'guided', replies: ALL });
  expect(await screen.findByRole('button', { name: '₹1,25,00,000' })).toBeTruthy();
  expect(screen.queryByText('₹1.25 crore')).toBeNull();
  cleanup();
  mount({ sub: 'weekahead', view: 'simple', language: 'hi', replies: ALL });
  expect(await screen.findByRole('button', { name: '₹1.25 करोड़' })).toBeTruthy();
});

test('RP-02 in Simple and Books: short or full money, receipts open, Books adds line ids and the receipt list', async () => {
  for (const view of ['simple', 'books'] as const) {
    const m = mount({ sub: 'packs', sheet: 'lender.key-financials', view, replies: ALL });
    const sheet = within(await screen.findByRole('region', { name: 'Key financials' }));
    const amount = sheet.getByRole('button', { name: view === 'simple' ? '₹2.5 lakh' : '₹2,50,000' });
    expect(amount.getAttribute('title')).toContain('25000000');
    await userEvent.click(amount);
    expect(m.openReceipt).toHaveBeenCalledWith('rc-sales');
    expect(sheet.getByText('hidden from your seat')).toBeTruthy();
    expect(sheet.queryByText('Line net-sales') !== null).toBe(view === 'books');
    expect(sheet.queryByText('Receipts on this page') !== null).toBe(view === 'books');
    cleanup();
  }
});

test('RP-04 in Simple and Books: Simple hides receipt links, Books shows receipt ids; the change is in words', async () => {
  for (const view of ['simple', 'books'] as const) {
    const m = mount({ sub: 'weekahead', view, replies: ALL });
    await screen.findByText('What changed');
    await userEvent.click(screen.getByRole('radio', { name: 'Friday' }));
    expect(await screen.findByText('Stopped credit to a synthetic customer')).toBeTruthy();
    expect(screen.getByText('What it would change: When a reminder is sent')).toBeTruthy();
    if (view === 'simple') expect(screen.queryByRole('button', { name: 'rc-dec' })).toBeNull();
    else { await userEvent.click(screen.getByRole('button', { name: 'rc-dec' })); expect(m.openReceipt).toHaveBeenCalledWith('rc-dec'); }
    expect(m.sent('reportsx.friday')[0]?.payload).toEqual({ language: 'en' });
    cleanup();
  }
});

test('RP-05 in Simple and Books: delivery reads the phone channels, with on or off, verified or not, and the exact message', async () => {
  for (const view of ['simple', 'books'] as const) {
    const m = mount({ sub: 'weekahead', sheet: 'rhythm', view, replies: ALL });
    const sheet = within(await screen.findByRole('region', { name: 'Rhythm and delivery' }));
    const whatsapp = within(await sheet.findByRole('region', { name: 'WhatsApp' }));
    expect(whatsapp.getByText('WhatsApp · On')).toBeTruthy();
    expect(whatsapp.getByText('Verified')).toBeTruthy();
    expect(whatsapp.getByText('Partial · The WhatsApp message template is not approved yet.')).toBeTruthy();
    expect(whatsapp.getByText('The week ahead is ready. Open Chausar to see it.')).toBeTruthy();
    const mail = within(sheet.getByRole('region', { name: 'Mail' }));
    expect(mail.getByText('Mail · On')).toBeTruthy();
    expect(mail.getByText('Not verified yet: nothing is sent.')).toBeTruthy();
    expect(within(sheet.getByRole('region', { name: 'Telegram' })).getByText('Telegram · Off')).toBeTruthy();
    expect(sheet.getByText(/^Last known state: the relay could not be reached just now\./)).toBeTruthy();
    expect(m.sent('phone.channels.list')).toEqual([{ method: 'phone.channels.list', payload: {} }]);
    expect(sheet.getByLabelText('Time (HH:MM)')).toBeTruthy();
    expect(sheet.queryByRole('button', { name: 'Verify' })).toBeNull();
    cleanup();
  }
});

test('RP-05 in Hindi asks for Hindi previews; a failed channel read is a sentence with its code', async () => {
  const m = mount({ sub: 'weekahead', sheet: 'rhythm', language: 'hi', replies: { ...ALL, 'phone.channels.list': () => new Refusal('HOSTED_NOT_CONFIGURED'),
    'reportsx.rhythm': (p: Record<string, unknown>) => ({ ...RHYTHM, previews: p['language'] === 'hi' ? { mail: 'आने वाले सप्ताह का सार तैयार है।', whatsapp: 'आने वाले सप्ताह का सार तैयार है।' } : RHYTHM.previews }) } });
  expect(await screen.findByText('ब्रीफ़ कहाँ जाते हैं, यह पढ़ा नहीं जा सका। कोड HOSTED_NOT_CONFIGURED')).toBeTruthy();
  expect(m.sent('reportsx.rhythm')[0]?.payload).toEqual({ language: 'hi' });
});

test('RP-08 in Simple and Books: a receipt is picked from saved answers that still open, sent once with the question', async () => {
  for (const view of ['simple', 'books'] as const) {
    const m = mount({ sub: 'exports', sheet: 'ask-a-person', view, replies: ALL });
    const sheet = within(await screen.findByRole('region', { name: 'Ask a person' }));
    const pick = await sheet.findByRole('radio', { name: 'Net sales in September, saved 10 Oct 2026' });
    expect(sheet.queryByRole('radio', { name: /A withheld answer/ })).toBeNull();
    expect(sheet.queryByRole('radio', { name: /A deleted answer/ })).toBeNull();
    await userEvent.type(sheet.getByLabelText('Your question'), 'Is this right?');
    await userEvent.click(pick);
    await userEvent.type(sheet.getByLabelText('Why you are asking'), 'Chausar said not yet.');
    await userEvent.click(sheet.getByRole('button', { name: 'Make the file' }));
    expect(await sheet.findByText('File: question-2026-10-14.html')).toBeTruthy();
    expect(m.sent('reportsx.askPerson')).toEqual([{ method: 'reportsx.askPerson', payload: { question: 'Is this right?', reason: 'Chausar said not yet.', receiptId: 'rc-sep' } }]);
    expect(sheet.queryByText('Open a question file')).toBeNull();
    cleanup();
  }
});

test('RP-08 without saved answers keeps the typed receipt id and says why', async () => {
  const m = mount({ sub: 'exports', sheet: 'ask-a-person', replies: { ...ALL, 'askx.saved': () => new Refusal('UNKNOWN_METHOD') } });
  const sheet = within(await screen.findByRole('region', { name: 'Ask a person' }));
  expect(await sheet.findByText('Saved answers cannot be listed here yet; type a receipt id instead.')).toBeTruthy();
  await userEvent.type(sheet.getByLabelText('Your question'), 'Why?');
  await userEvent.type(sheet.getByLabelText('Receipt id (optional)'), 'rc-typed');
  await userEvent.type(sheet.getByLabelText('Why you are asking'), 'Not yet.');
  await userEvent.click(sheet.getByRole('button', { name: 'Make the file' }));
  await waitFor(() => expect(m.sent('reportsx.askPerson')).toEqual([{ method: 'reportsx.askPerson', payload: { question: 'Why?', reason: 'Not yet.', receiptId: 'rc-typed' } }]));
});

test('RP-08 an accountant opens a question file as text; nobody else sees the control', async () => {
  for (const view of ['simple', 'books'] as const) {
    const m = mount({ sub: 'exports', sheet: 'ask-a-person', view, role: 'accountant', replies: ALL });
    const sheet = within(await screen.findByRole('region', { name: 'Ask a person' }));
    expect(sheet.getByText('Open a question file')).toBeTruthy();
    await userEvent.click(await sheet.findByRole('button', { name: 'Open' }));
    const opened = within(await sheet.findByRole('region', { name: 'question-2026-10-14T06-00-00-000Z.html' }));
    const text = opened.getByText(/Is <b>this<\/b> right\?/);
    expect(text.tagName).toBe('PRE');
    expect(text.querySelector('b')).toBeNull();
    expect(m.sent('reportsx.openQuestion')).toEqual([{ method: 'reportsx.openQuestion', payload: { name: 'question-2026-10-14T06-00-00-000Z.html' } }]);
    cleanup();
  }
  mount({ sub: 'exports', sheet: 'ask-a-person', role: 'accountant', language: 'hi', replies: { ...ALL, 'reportsx.questions': () => new Refusal('UNKNOWN_METHOD') } });
  expect(await screen.findByText('सवाल की फ़ाइलें खोलना अभी बना नहीं है।')).toBeTruthy();
  cleanup();
  for (const [role, viewer] of [['owner', false], ['cofounder', false], ['viewer', true]] as const) {
    const m = mount({ sub: 'exports', sheet: 'ask-a-person', role, viewer, replies: ALL });
    await screen.findByRole('region', { name: 'Ask a person' });
    expect(screen.queryByText('Open a question file')).toBeNull();
    expect(m.sent('reportsx.questions')).toEqual([]);
    cleanup();
  }
});

test('a reply that names a question file outside the plain form is refused as invalid', async () => {
  mount({ sub: 'exports', sheet: 'ask-a-person', role: 'accountant', replies: { ...ALL, 'reportsx.questions': { items: [{ name: '../secret.html', bytes: 1, at: '2026-10-14T06:00:00.000Z' }] } } });
  expect(await screen.findByText('Code INVALID_REPLY')).toBeTruthy();
});
