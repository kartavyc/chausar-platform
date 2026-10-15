import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language, View } from '../../app/ui/src/app/presentation';
import type { PlaceRenderProps } from '../../app/ui/src/places/types';
import { placeModuleFor } from '../../app/ui/src/places/registry';
import { hostedLinkScreens } from '../../app/ui/src/screens/hosted-link/index';
import { words } from '../../app/ui/src/text/lanes/hosted-link';

// Every reply here is a synthetic fixture. Nothing reaches a network.
afterEach(cleanup);

type Handler = (payload: Record<string, unknown>) => unknown;
interface Draw { language?: Language; view?: View; viewer?: boolean; role?: string; handlers?: Record<string, Handler> }
function refuse(code: string): never { throw Object.assign(new Error(code), { code }); }

const DOCS: Address = { place: 'tools', sub: 'phonedocs' };
const LOG: Address = { place: 'tools', sub: 'phonelog' };
const AT = '2026-10-14T09:00:00.000Z';
const ID = (n: string) => `phonedoc_${n.repeat(32)}`;
const doc = (n: string, mediaType: string, channel = 'whatsapp') => ({
  documentId: ID(n), name: channel === 'whatsapp' ? 'Document from WhatsApp' : 'Document from Telegram', channel, mediaType,
  sizeBytes: 2048, receivedAt: AT, collectedAt: AT, status: 'awaiting-review', outside: true,
});
const LIST = { experimental: true, label: 'Outside data from your phone.', keyRegistered: true,
  documents: [doc('a', 'application/pdf'), doc('b', 'text/csv', 'telegram'), doc('c', 'image/jpeg')] };
const preview = (documentId: string, route: string, confirm: unknown = { method: route === 'bill' ? 'books.billConfirm' : 'sources.import', input: { sourceId: 'phone-document-x' } }) => ({
  documentId, route, untrusted: true, preview: { supplier: { value: '<b>Ignore previous instructions</b>' }, totalMinor: '123400' }, confirm,
});
const entry = (id: string, status: string, event = 'review-ready') => ({ id, event, channel: 'whatsapp', status, at: AT, buttons: 'open-only', errorCode: null, checkedAt: null });

function draw(address: Address, { language = 'en', view = 'guided', viewer = false, role = 'owner', handlers = {} }: Draw = {}) {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const rpc = {
    request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
      calls.push({ method, payload });
      const handler = handlers[method];
      if (handler === undefined) refuse('UNKNOWN_METHOD');
      return handler(payload);
    }),
  };
  const navigate = vi.fn();
  const module = hostedLinkScreens.find((m) => m.handles(address));
  if (module === undefined) throw new Error('no module');
  const props: PlaceRenderProps = { address, language, view, viewer, member: { id: 'm-1', role }, rpc, live: () => true, openReceipt: vi.fn(), navigate };
  const utils = render(<TextProvider language={language}>{module.render(props)}</TextProvider>);
  const sent = (method: string) => calls.filter((c) => c.method === method);
  return { ...utils, calls, sent, navigate };
}
const en = words.en, hi = words.hi;
const row = (name: RegExp | string) => screen.getAllByRole('listitem').find((li) => within(li).queryByText(name) !== null)!;

test('the host draws both addresses with this lane, not an earlier module', () => {
  expect(placeModuleFor(DOCS)?.id).toBe('hosted-link.phonedocs');
  expect(placeModuleFor(LOG)?.id).toBe('hosted-link.phonelog');
});

for (const language of ['en', 'hi'] as const) {
  for (const view of ['simple', 'guided', 'books'] as const) {
    test(`documents draw as outside data, not imported, in ${language} ${view}`, async () => {
      draw(DOCS, { language, view, handlers: { 'phone.documents.list': () => LIST } });
      expect(await screen.findByRole('heading', { level: 1, name: words[language]['SH-01.sub.tools.phonedocs'] })).toBeTruthy();
      expect(screen.getAllByText(words[language]['HL.docs.outside'])).toHaveLength(3);
      if (view === 'books') expect(screen.getByText(words[language]['HL.docs.id'].replace('{id}', ID('a')))).toBeTruthy();
      else expect(screen.queryByText(new RegExp(ID('a')))).toBeNull();
    });
    test(`lost messages draw in words in ${language} ${view}`, async () => {
      const { sent } = draw(LOG, { language, view, handlers: { 'phone.messages.log': () => ({ messages: [entry('msg_1', 'unknown')], lost: 1 }) } });
      expect(await screen.findByText(words[language]['HL.log.status.unknown'])).toBeTruthy();
      expect(screen.getByText(words[language]['HL.log.event.review-ready'])).toBeTruthy();
      expect(sent('phone.messages.log')[0]!.payload).toEqual({ filter: 'lost' });
      expect(screen.queryByRole('radiogroup') === null).toBe(view === 'simple');
    });
  }
}

test('documents: empty, not built, locked, error and an invalid reply', async () => {
  draw(DOCS, { handlers: { 'phone.documents.list': () => ({ documents: [], keyRegistered: true }) } });
  expect(await screen.findByText(en['HL.docs.empty'])).toBeTruthy();
  expect(screen.getByRole('button', { name: en['HL.docs.collect'] })).toBeTruthy();
  cleanup();
  draw(DOCS);
  expect(await screen.findByText(/not built yet/i)).toBeTruthy();
  expect(screen.queryByRole('button', { name: en['HL.docs.collect'] })).toBeNull();
  cleanup();
  draw(DOCS, { handlers: { 'phone.documents.list': () => refuse('VAULT_LOCKED') } });
  expect(await screen.findByText(/locked/i)).toBeTruthy();
  cleanup();
  draw(DOCS, { handlers: { 'phone.documents.list': () => refuse('HOSTED_NOT_PAIRED') } });
  expect(await screen.findByText(en['HL.refusal.HOSTED_NOT_PAIRED'])).toBeTruthy();
  cleanup();
  draw(DOCS, { handlers: { 'phone.documents.list': () => ({ documents: [{ ...doc('a', 'application/pdf'), channel: 'sms' }] }) } });
  expect(await screen.findByText(/INVALID_REPLY/)).toBeTruthy();
  expect(screen.queryByText('Document from WhatsApp')).toBeNull();
});

test('documents: a viewer sees the rows but no control; partial coverage when the key is not registered', async () => {
  draw(DOCS, { viewer: true, handlers: { 'phone.documents.list': () => ({ ...LIST, keyRegistered: false }) } });
  expect(await screen.findByText(en['HL.readOnly'])).toBeTruthy();
  expect(screen.getByText(en['HL.docs.keyMissing'])).toBeTruthy();
  expect(screen.queryByRole('button', { name: en['HL.docs.read'] })).toBeNull();
  expect(screen.queryByRole('button', { name: en['HL.docs.discard'] })).toBeNull();
  expect(screen.queryByRole('button', { name: en['HL.docs.collect'] })).toBeNull();
});

test('check for new documents collects, rereads, and says when some did not arrive; a failed reread keeps the rows as stale', async () => {
  let reads = 0;
  const { sent } = draw(DOCS, { handlers: {
    'phone.documents.list': () => { reads++; if (reads === 3) refuse('REQUEST_FAILED'); return LIST; },
    'phone.documents.collect': () => ({ collected: [{ documentId: 'r1', outcome: 'held', localId: ID('a') }, { documentId: 'r2', outcome: 'not-collected', reason: 'HOSTED_UNREACHABLE' }] }),
  } });
  await screen.findAllByText(en['HL.docs.outside']);
  await userEvent.click(screen.getByRole('button', { name: en['HL.docs.collect'] }));
  expect(await screen.findByText(en['HL.docs.partial'])).toBeTruthy();
  expect(sent('phone.documents.collect')).toHaveLength(1);
  expect(sent('phone.documents.list')).toHaveLength(2);
  await userEvent.click(screen.getByRole('button', { name: en['HL.docs.collect'] }));
  expect(await screen.findByText(en['HL.stale'])).toBeTruthy();
  expect(screen.getAllByText(en['HL.docs.outside'])).toHaveLength(3);
});

test('a PDF must be read as a statement or a bill: nothing is sent until one is chosen', async () => {
  const { sent } = draw(DOCS, { handlers: {
    'phone.documents.list': () => LIST,
    'phone.documents.preview': (p) => preview(String(p['documentId']), String(p['as'])),
  } });
  await screen.findAllByText(en['HL.docs.outside']);
  const pdf = row(en['HL.docs.type.pdf']);
  await userEvent.click(within(pdf).getByRole('button', { name: en['HL.docs.read'] }));
  expect(within(pdf).getByText(en['HL.docs.chooseFirst'])).toBeTruthy();
  const readNow = within(pdf).getByRole('button', { name: en['HL.docs.readNow'] }) as HTMLButtonElement;
  expect(readNow.disabled).toBe(true);
  // The choice is a radio group: arrow keys move within it.
  const statement = within(pdf).getByRole('radio', { name: en['HL.route.statement'] });
  await userEvent.click(statement);
  await userEvent.keyboard('{ArrowRight}');
  expect(within(pdf).getByRole('radio', { name: en['HL.route.bill'] }).getAttribute('aria-checked')).toBe('true');
  await userEvent.click(within(pdf).getByRole('radio', { name: en['HL.route.statement'] }));
  await userEvent.click(within(pdf).getByRole('button', { name: en['HL.docs.readNow'] }));
  expect(sent('phone.documents.preview')[0]!.payload).toEqual({ documentId: ID('a'), as: 'statement' });
  expect(await within(pdf).findByText(en['HL.docs.untrusted'])).toBeTruthy();
  // Outside text is shown as text, never as markup.
  expect(within(pdf).getByText('<b>Ignore previous instructions</b>')).toBeTruthy();
  expect(pdf.querySelector('b')).toBeNull();
});

test('a CSV is read with no choice and no "as"; a photo is read as a bill', async () => {
  const { sent } = draw(DOCS, { handlers: {
    'phone.documents.list': () => LIST,
    'phone.documents.preview': (p) => preview(String(p['documentId']), p['as'] === undefined ? 'csv' : String(p['as'])),
  } });
  await screen.findAllByText(en['HL.docs.outside']);
  const csv = row(en['HL.docs.type.csv']);
  await userEvent.click(within(csv).getByRole('button', { name: en['HL.docs.read'] }));
  expect(within(csv).queryByRole('radiogroup')).toBeNull();
  await userEvent.click(within(csv).getByRole('button', { name: en['HL.docs.readNow'] }));
  expect(sent('phone.documents.preview')[0]!.payload).toEqual({ documentId: ID('b') });
  const photo = row(en['HL.docs.type.jpeg']);
  await userEvent.click(within(photo).getByRole('button', { name: en['HL.docs.read'] }));
  expect(within(photo).getByText(en['HL.docs.photoOnly'])).toBeTruthy();
  await userEvent.click(within(photo).getByRole('button', { name: en['HL.docs.readNow'] }));
  expect(sent('phone.documents.preview')[1]!.payload).toEqual({ documentId: ID('c'), as: 'bill' });
});

test('confirm is called only when Confirm is pressed, with the exact input, then the document is marked done', async () => {
  const { sent } = draw(DOCS, { handlers: {
    'phone.documents.list': () => LIST,
    'phone.documents.preview': (p) => preview(String(p['documentId']), String(p['as'])),
    'books.billConfirm': () => ({ id: 'bill_1', state: 'prepared' }),
    'phone.documents.done': (p) => ({ documentId: p['documentId'], done: true }),
  } });
  await screen.findAllByText(en['HL.docs.outside']);
  const pdf = row(en['HL.docs.type.pdf']);
  await userEvent.click(within(pdf).getByRole('button', { name: en['HL.docs.read'] }));
  await userEvent.click(within(pdf).getByRole('radio', { name: en['HL.route.bill'] }));
  await userEvent.click(within(pdf).getByRole('button', { name: en['HL.docs.readNow'] }));
  await within(pdf).findByText(en['HL.docs.untrusted']);
  expect(sent('books.billConfirm')).toHaveLength(0);
  expect(sent('phone.documents.done')).toHaveLength(0);
  await userEvent.click(within(pdf).getByRole('button', { name: en['HL.docs.confirm'] }));
  expect(await screen.findByText(en['HL.docs.confirmed'])).toBeTruthy();
  expect(sent('books.billConfirm').map((c) => c.payload)).toEqual([{ sourceId: 'phone-document-x' }]);
  expect(sent('phone.documents.done').map((c) => c.payload)).toEqual([{ documentId: ID('a') }]);
  expect(sent('phone.documents.list')).toHaveLength(2);
});

test('a reading with nothing to confirm offers no Confirm; a refused read says why; a missing done says so', async () => {
  draw(DOCS, { handlers: {
    'phone.documents.list': () => LIST,
    'phone.documents.preview': (p) => p['as'] === 'statement' ? refuse('DOCUMENT_READER_UNAVAILABLE') : p['as'] === 'bill'
      ? preview(String(p['documentId']), 'bill') : preview(String(p['documentId']), 'csv', null),
    'sources.import': () => ({ imported: true }),
    'books.billConfirm': () => ({ id: 'bill_1' }),
  } });
  await screen.findAllByText(en['HL.docs.outside']);
  const csv = row(en['HL.docs.type.csv']);
  await userEvent.click(within(csv).getByRole('button', { name: en['HL.docs.read'] }));
  await userEvent.click(within(csv).getByRole('button', { name: en['HL.docs.readNow'] }));
  expect(await within(csv).findByText(en['HL.docs.noConfirm'])).toBeTruthy();
  expect(within(csv).queryByRole('button', { name: en['HL.docs.confirm'] })).toBeNull();
  const pdf = row(en['HL.docs.type.pdf']);
  await userEvent.click(within(pdf).getByRole('button', { name: en['HL.docs.read'] }));
  await userEvent.click(within(pdf).getByRole('radio', { name: en['HL.route.statement'] }));
  await userEvent.click(within(pdf).getByRole('button', { name: en['HL.docs.readNow'] }));
  expect(await within(pdf).findByText(en['HL.refusal.DOCUMENT_READER_UNAVAILABLE'])).toBeTruthy();
  await userEvent.click(within(pdf).getByRole('radio', { name: en['HL.route.bill'] }));
  await userEvent.click(within(pdf).getByRole('button', { name: en['HL.docs.readNow'] }));
  await userEvent.click(await within(pdf).findByRole('button', { name: en['HL.docs.confirm'] }));
  expect(await within(pdf).findByText(en['HL.docs.doneNotBuilt'])).toBeTruthy();
});

test('a preview that is not marked untrusted, or names another confirm, is refused and nothing is offered', async () => {
  const { sent } = draw(DOCS, { handlers: {
    'phone.documents.list': () => LIST,
    'phone.documents.preview': (p) => ({ ...preview(String(p['documentId']), 'csv'), confirm: { method: 'workspace.delete', input: {} } }),
  } });
  await screen.findAllByText(en['HL.docs.outside']);
  const csv = row(en['HL.docs.type.csv']);
  await userEvent.click(within(csv).getByRole('button', { name: en['HL.docs.read'] }));
  await userEvent.click(within(csv).getByRole('button', { name: en['HL.docs.readNow'] }));
  expect(await within(csv).findByText(en['HL.refusal.INVALID_REPLY'])).toBeTruthy();
  expect(within(csv).queryByRole('button', { name: en['HL.docs.confirm'] })).toBeNull();
  expect(sent('workspace.delete')).toHaveLength(0);
});

test('discard asks first, then discards and rereads; Keep it sends nothing', async () => {
  const { sent } = draw(DOCS, { handlers: {
    'phone.documents.list': () => LIST,
    'phone.documents.discard': (p) => ({ documentId: p['documentId'], discarded: true }),
  } });
  await screen.findAllByText(en['HL.docs.outside']);
  const csv = row(en['HL.docs.type.csv']);
  await userEvent.click(within(csv).getByRole('button', { name: en['HL.docs.discard'] }));
  await userEvent.click(within(csv).getByRole('button', { name: en['HL.docs.keep'] }));
  expect(sent('phone.documents.discard')).toHaveLength(0);
  await userEvent.click(within(csv).getByRole('button', { name: en['HL.docs.discard'] }));
  await userEvent.click(within(csv).getByRole('button', { name: en['HL.docs.discardYes'] }));
  expect(await screen.findByText(en['HL.docs.discarded'])).toBeTruthy();
  expect(sent('phone.documents.discard').map((c) => c.payload)).toEqual([{ documentId: ID('b') }]);
});

test('lost messages: Check asks the relay and sends nothing again; a still-unknown result says so', async () => {
  let round = 0;
  const { sent } = draw(LOG, { handlers: {
    'phone.messages.log': () => ({ messages: [entry('msg_1', 'unknown'), entry('msg_2', 'unknown', 'due-date-near')], lost: 2 }),
    'phone.messages.check': (p) => (++round === 1 ? { ...entry(String(p['id']), 'delivered'), checkedAt: AT } : entry(String(p['id']), 'unknown', 'due-date-near')),
  } });
  await screen.findByText(en['HL.log.event.review-ready']);
  expect(screen.getByText(en['HL.log.intro'])).toBeTruthy();
  const first = row(en['HL.log.event.review-ready']);
  await userEvent.click(within(first).getByRole('button', { name: `Check with the relay: ${en['HL.log.event.review-ready']}` }));
  expect(await within(first).findByText(en['HL.log.checked'])).toBeTruthy();
  expect(within(first).getByText(en['HL.log.status.delivered'])).toBeTruthy();
  expect(within(first).getByText(en['HL.log.deliveredNote'])).toBeTruthy();
  expect(within(first).queryByRole('button', { name: /Check/ })).toBeNull();
  const second = row(en['HL.log.event.due-date-near']);
  await userEvent.click(within(second).getByRole('button', { name: /Check/ }));
  expect(await within(second).findByText(en['HL.log.stillUnknown'])).toBeTruthy();
  expect(sent('phone.messages.check').map((c) => c.payload)).toEqual([{ id: 'msg_1' }, { id: 'msg_2' }]);
  expect(sent('phone.messages.send')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: /send|resend/i })).toBeNull();
});

test('lost messages: All shows every status in words; empty, not built, a refused check and a viewer', async () => {
  const { sent } = draw(LOG, { handlers: {
    'phone.messages.log': (p) => p['filter'] === 'all'
      ? { messages: [entry('m1', 'failed'), entry('m2', 'queued', 'week-ahead-ready'), entry('m3', 'read', 'document-received')], lost: 0 }
      : { messages: [], lost: 0 },
  } });
  expect(await screen.findByText(en['HL.log.empty.lost'])).toBeTruthy();
  await userEvent.click(screen.getByRole('radio', { name: en['HL.log.filter.all'] }));
  expect(await screen.findByText(en['HL.log.status.failed'])).toBeTruthy();
  expect(screen.getByText(en['HL.log.status.queued'])).toBeTruthy();
  expect(screen.getByText(en['HL.log.status.read'])).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Check/ })).toBeNull();
  expect(sent('phone.messages.log').map((c) => c.payload)).toEqual([{ filter: 'lost' }, { filter: 'all' }]);
  cleanup();
  draw(LOG);
  expect(await screen.findByText(/not built yet/i)).toBeTruthy();
  cleanup();
  draw(LOG, { handlers: { 'phone.messages.log': () => ({ messages: [entry('msg_1', 'unknown')], lost: 1 }) } });
  const r = row(await screen.findByText(en['HL.log.event.review-ready']).then(() => en['HL.log.event.review-ready']));
  await userEvent.click(within(r).getByRole('button', { name: /Check/ }));
  expect(await within(r).findByText(en['HL.stepNotBuilt'])).toBeTruthy();
  cleanup();
  draw(LOG, { viewer: true, handlers: { 'phone.messages.log': () => ({ messages: [entry('msg_1', 'unknown')], lost: 1 }) } });
  expect(await screen.findByText(en['HL.readOnly'])).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Check/ })).toBeNull();
});

test('Hindi words draw the lost status and the Check button', async () => {
  draw(LOG, { language: 'hi', handlers: { 'phone.messages.log': () => ({ messages: [entry('msg_1', 'unknown')], lost: 1 }) } });
  expect(await screen.findByText(hi['HL.log.status.unknown'])).toBeTruthy();
  expect(screen.getByRole('button', { name: new RegExp(hi['HL.log.event.review-ready']) })).toBeTruthy();
});

test('the Phone settings link opens Tools, Phone', async () => {
  const { navigate } = draw(DOCS, { handlers: { 'phone.documents.list': () => LIST } });
  await userEvent.click(await screen.findByRole('button', { name: en['HL.phoneLink'] }));
  expect(navigate).toHaveBeenCalledWith({ place: 'tools', sub: 'phone' });
});

// A `books.billRead` reply as work-books writes it, held under the preview (synthetic).
const field = (value: string | null, certainty = 'sure') => ({ value, certainty, region: null });
let readCount = 0;
const billPreview = (documentId: string) => {
  const readId = `billread_${++readCount}`;
  return {
    documentId, route: 'bill', untrusted: true, outside: true, imported: false,
    preview: { readId, digest: 'd'.repeat(64), mime: 'image/jpeg', stored: false, untrusted: true,
      supplier: field('Sharma Traders'), billNumber: field('INV-7'), date: field('2026-10-01'),
      lines: [{ description: field('Rice'), quantity: field('2'), amount: field('100000') }, { description: field('Oil', 'check-this'), quantity: field('1', 'check-this'), amount: field(null, 'could-not-read') }],
      tax: [{ name: field('GST'), amount: field('5000') }], total: field('123400'), sums: { linesPlusTax: { missing: 'unknown' }, total: { minor: '123400' }, equal: null } },
    confirm: { method: 'books.billConfirm', input: { readId, digest: 'd'.repeat(64) }, add: ['fields'] },
  };
};
async function openBill(sentRead = false) {
  await screen.findAllByText(en['HL.docs.outside']);
  const photo = row(en['HL.docs.type.jpeg']);
  await userEvent.click(within(photo).getByRole('button', { name: en['HL.docs.read'] }));
  if (!sentRead) await userEvent.click(within(photo).getByRole('button', { name: en['HL.docs.readNow'] }));
  const form = await within(photo).findByRole('form', { name: en['HL.bill.form'] });
  return { photo, form };
}

test('a bill whose confirm needs fields is checked here, field by field, and confirmed with exactly the engine shape', async () => {
  let attempts = 0;
  const { sent, navigate } = draw(DOCS, { handlers: {
    'phone.documents.list': () => LIST,
    'phone.documents.preview': (p) => billPreview(String(p['documentId'])),
    'books.billConfirm': () => (++attempts === 1 ? refuse('BILL_TOTAL_MISMATCH') : { id: 'bill_1', approvalId: 'bill:bill_1', state: 'prepared' }),
    'phone.documents.done': (p) => ({ documentId: p['documentId'], done: true }),
  } });
  const { photo, form } = await openBill();
  // No hand-off to another screen any more.
  expect(within(photo).queryByText(/Bill photo/)).toBeNull();
  expect((within(form).getByLabelText(en['HL.bill.supplier']) as HTMLInputElement).value).toBe('Sharma Traders');
  expect((within(form).getByLabelText(en['HL.bill.date']) as HTMLInputElement).value).toBe('2026-10-01');
  expect((within(form).getByLabelText(en['HL.bill.total']) as HTMLInputElement).value).toBe('1234.00');
  expect(within(form).getAllByText(en['HL.bill.cert.could-not-read'])).toHaveLength(1);
  expect(within(form).getAllByText(en['HL.bill.cert.check-this'])).toHaveLength(2);
  // The unread amount must be written before Confirm can send anything.
  const confirm = within(form).getByRole('button', { name: en['HL.docs.confirm'] }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  expect(within(form).getByText(en['HL.bill.notReady'])).toBeTruthy();
  const second = within(form).getByRole('group', { name: `${en['HL.bill.lines']} 2` });
  await userEvent.type(within(second).getByLabelText(en['HL.bill.amount']), '1,84.5');
  expect(confirm.disabled).toBe(true);
  await userEvent.clear(within(second).getByLabelText(en['HL.bill.amount']));
  await userEvent.type(within(second).getByLabelText(en['HL.bill.amount']), '184');
  const supplier = within(form).getByLabelText(en['HL.bill.supplier']);
  await userEvent.clear(supplier);
  await userEvent.type(supplier, 'Sharma Traders Pvt');
  expect(sent('books.billConfirm')).toHaveLength(0);
  await userEvent.click(confirm);
  // The engine checks the sum; its refusal is drawn in words and nothing is marked done.
  expect(await within(photo).findByText(en['HL.refusal.BILL_TOTAL_MISMATCH'])).toBeTruthy();
  expect(sent('phone.documents.done')).toHaveLength(0);
  await userEvent.click(within(form).getByRole('button', { name: en['HL.docs.confirm'] }));
  expect(await screen.findByText(en['HL.bill.confirmed'])).toBeTruthy();
  const exact = { readId: 'billread_1', digest: 'd'.repeat(64), fields: { supplier: 'Sharma Traders Pvt', billNumber: 'INV-7', date: '2026-10-01',
    lines: [{ description: 'Rice', quantity: '2', amountMinor: '100000' }, { description: 'Oil', quantity: '1', amountMinor: '18400' }],
    tax: [{ name: 'GST', amountMinor: '5000' }], totalMinor: '123400' } };
  expect(sent('books.billConfirm').map((c) => c.payload)).toEqual([exact, exact]);
  expect(sent('phone.documents.done').map((c) => c.payload)).toEqual([{ documentId: ID('c') }]);
  expect(navigate).not.toHaveBeenCalled();
});

test('bill refusals are drawn in words; a reading no longer held offers to read the document again', async () => {
  readCount = 0;
  const codes = ['BILL_FIELD_MISSING', 'PREVIEW_CHANGED', 'BILL_READ_EXPIRED'];
  const { sent } = draw(DOCS, { language: 'hi', handlers: {
    'phone.documents.list': () => LIST,
    'phone.documents.preview': (p) => billPreview(String(p['documentId'])),
    'books.billConfirm': () => refuse(codes.shift()!),
  } });
  await screen.findAllByText(hi['HL.docs.outside']);
  const photo = row(hi['HL.docs.type.jpeg']);
  await userEvent.click(within(photo).getByRole('button', { name: hi['HL.docs.read'] }));
  await userEvent.click(within(photo).getAllByRole('button', { name: hi['HL.docs.readNow'] })[0]!);
  const form = await within(photo).findByRole('form', { name: hi['HL.bill.form'] });
  await userEvent.type(within(within(form).getByRole('group', { name: `${hi['HL.bill.lines']} 2` })).getByLabelText(hi['HL.bill.amount']), '184');
  await userEvent.clear(within(form).getByLabelText(hi['HL.bill.supplier']));
  await userEvent.click(within(form).getByRole('button', { name: hi['HL.docs.confirm'] }));
  expect(await within(photo).findByText(hi['HL.refusal.BILL_FIELD_MISSING'])).toBeTruthy();
  expect(within(photo).queryByRole('button', { name: hi['HL.bill.readAgain'] })).toBeNull();
  await userEvent.click(within(form).getByRole('button', { name: hi['HL.docs.confirm'] }));
  expect(await within(photo).findByText(hi['HL.refusal.PREVIEW_CHANGED'])).toBeTruthy();
  await userEvent.click(within(form).getByRole('button', { name: hi['HL.docs.confirm'] }));
  expect(await within(photo).findByText(hi['HL.refusal.BILL_READ_EXPIRED'])).toBeTruthy();
  await userEvent.click(within(photo).getByRole('button', { name: hi['HL.bill.readAgain'] }));
  const fresh = await within(photo).findByRole('form', { name: hi['HL.bill.form'] });
  expect((within(fresh).getByLabelText(hi['HL.bill.supplier']) as HTMLInputElement).value).toBe('Sharma Traders');
  expect(sent('phone.documents.preview')).toHaveLength(2);
  expect(sent('phone.documents.done')).toHaveLength(0);
});

test('a checked message the relay never received reads as not sent, and says to send it again from the app without a resend button', async () => {
  const { sent } = draw(LOG, { handlers: {
    'phone.messages.log': () => ({ messages: [entry('msg_1', 'unknown')], lost: 1 }),
    'phone.messages.check': (p) => ({ ...entry(String(p['id']), 'not-sent'), checkedAt: AT, sendAgain: true }),
  } });
  const r = row(await screen.findByText(en['HL.log.event.review-ready']).then(() => en['HL.log.event.review-ready']));
  await userEvent.click(within(r).getByRole('button', { name: /Check/ }));
  expect(await within(r).findByText(en['HL.log.status.not-sent'])).toBeTruthy();
  expect(within(r).getByText(en['HL.log.sendAgain'])).toBeTruthy();
  expect(within(r).queryByText(en['HL.refusal.INVALID_REPLY'])).toBeNull();
  expect(screen.queryByRole('button', { name: /send/i })).toBeNull();
  expect(sent('phone.messages.send')).toHaveLength(0);
});

test('a statement with nothing to confirm says why, in words', async () => {
  draw(DOCS, { handlers: {
    'phone.documents.list': () => LIST,
    'phone.documents.preview': (p) => ({ ...preview(String(p['documentId']), 'statement', null), confirmReason: 'statement-question' }),
  } });
  await screen.findAllByText(en['HL.docs.outside']);
  const pdf = row(en['HL.docs.type.pdf']);
  await userEvent.click(within(pdf).getByRole('button', { name: en['HL.docs.read'] }));
  await userEvent.click(within(pdf).getByRole('radio', { name: en['HL.route.statement'] }));
  await userEvent.click(within(pdf).getByRole('button', { name: en['HL.docs.readNow'] }));
  expect(await within(pdf).findByText(en['HL.docs.noConfirm.statement-question'])).toBeTruthy();
  expect(within(pdf).queryByRole('button', { name: en['HL.docs.confirm'] })).toBeNull();
});

test('a message from an earlier pairing says so, and a check refused for it is drawn in words', async () => {
  draw(LOG, { handlers: {
    'phone.messages.log': () => ({ messages: [{ ...entry('m1', 'unknown'), errorCode: 'MESSAGE_OTHER_PAIRING' }], lost: 1 }),
    'phone.messages.check': () => refuse('MESSAGE_OTHER_PAIRING'),
  } });
  await screen.findByText(en['HL.log.event.review-ready']);
  const r = row(en['HL.log.event.review-ready']);
  expect(within(r).getByText(en['HL.refusal.MESSAGE_OTHER_PAIRING'])).toBeTruthy();
  await userEvent.click(within(r).getByRole('button', { name: /Check/ }));
  expect(await within(r).findAllByText(en['HL.refusal.MESSAGE_OTHER_PAIRING'])).toHaveLength(2);
});

test('the Lost messages log draws a not-sent row; a check refused as too soon says so in words', async () => {
  draw(LOG, { view: 'books', handlers: {
    'phone.messages.log': (p) => p['filter'] === 'all'
      ? { messages: [{ ...entry('m1', 'not-sent'), checkedAt: AT }, entry('m2', 'unknown', 'due-date-near')], lost: 1 }
      : { messages: [entry('m2', 'unknown', 'due-date-near')], lost: 1 },
    'phone.messages.check': () => refuse('MESSAGE_CHECK_TOO_SOON'),
  } });
  await screen.findByText(en['HL.log.event.due-date-near']);
  await userEvent.click(screen.getByRole('radio', { name: en['HL.log.filter.all'] }));
  expect(await screen.findByText(en['HL.log.status.not-sent'])).toBeTruthy();
  const r = row(en['HL.log.event.due-date-near']);
  await userEvent.click(within(r).getByRole('button', { name: /Check/ }));
  expect(await within(r).findByText(en['HL.refusal.MESSAGE_CHECK_TOO_SOON'])).toBeTruthy();
});
