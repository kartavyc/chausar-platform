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

test('a bill whose confirm needs checked fields offers no Confirm here, only the way to Books, Bill photo', async () => {
  const { sent, navigate } = draw(DOCS, { handlers: {
    'phone.documents.list': () => LIST,
    'phone.documents.preview': (p) => preview(String(p['documentId']), 'bill', { method: 'books.billConfirm', input: { readId: 'billread_x', digest: 'd'.repeat(64) }, add: ['fields'] }),
  } });
  await screen.findAllByText(en['HL.docs.outside']);
  const pdf = row(en['HL.docs.type.pdf']);
  await userEvent.click(within(pdf).getByRole('button', { name: en['HL.docs.read'] }));
  await userEvent.click(within(pdf).getByRole('radio', { name: en['HL.route.bill'] }));
  await userEvent.click(within(pdf).getByRole('button', { name: en['HL.docs.readNow'] }));
  await within(pdf).findByText(en['HL.docs.billElsewhere']);
  expect(within(pdf).queryByRole('button', { name: en['HL.docs.confirm'] })).toBeNull();
  await userEvent.click(within(pdf).getByRole('button', { name: en['HL.docs.billLink'] }));
  expect(navigate).toHaveBeenCalledWith({ place: 'books', sub: 'bill' });
  expect(sent('books.billConfirm')).toHaveLength(0);
});
