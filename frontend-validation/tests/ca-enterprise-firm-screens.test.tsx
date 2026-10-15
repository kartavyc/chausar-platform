// CA console screens (CA-01, CA-02, CA-06, CA-09) and the client's "Your CA firm", driven through
// their place modules with a fake `rpc` whose replies follow docs/lanes/ca-enterprise.md.
// All data is synthetic.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language } from '../../app/ui/src/app/presentation';
import type { PlaceRenderProps } from '../../app/ui/src/places/types';
import { firmPlaces } from '../../app/ui/src/screens/ca-enterprise/firm/index';

afterEach(cleanup);

const AT = '2026-10-14T09:00:00Z';
const CLOSE = { bank: 'done', gst: 'in-progress', tds: 'not-done', tb: 'done' };
const HANDOVER = { tb: 'ready', bankRec: 'not-ready', gstMatch: 'refused', tdsMatch: 'ready', ageing: 'ready' };
const JOINED = {
  clientId: 'client_1', name: 'Demo shop', state: 'joined', booksReadAt: AT, close: CLOSE, awaiting: null,
  dueNext: { code: 'gstr3b-monthly', date: '2026-10-20' }, cardAt: AT, stale: false, seat: { seat: 'ca', endsOn: '2026-12-31' },
};
const COUNTED = { ...JOINED, clientId: 'client_2', name: 'Second shop', awaiting: 4, dueNext: { code: 'zz-local-code', date: '2026-10-25' } };
const INVITED = {
  clientId: 'client_3', name: 'New client', state: 'invited', booksReadAt: null, close: null, awaiting: null, dueNext: null, cardAt: null, stale: false, seat: null,
};
const LIST = { month: '2026-09', rows: [JOINED, COUNTED, INVITED], counts: { needsYou: 2, closeNotDone: 2, all: 3 }, nextCursor: null };
const CARD = {
  v: 1, kind: 'chausar.ca-status', workspaceId: 'ws_demo', link: 'a'.repeat(64), issuedAt: AT, month: '2026-09', booksReadAt: AT, close: CLOSE,
  cosign: { meanings: 2, recipes: null, accountClasses: 0 }, questions: { count: 1, oldestAt: AT }, handover: HANDOVER,
  dueNext: { code: 'tds-deposit', date: '2026-11-07' }, seats: [{ seat: 'accountant', endsOn: null }], consent: 'draft-1', mac: 'b'.repeat(64),
};
const GUIDE = { clientId: 'client_9', code: 'ABCDEFGHIJKLMNO2', guide: { html: '<h1>How to link your CA firm</h1>' } };

type Reply = unknown;
type Call = { method: string; payload: Record<string, unknown> };

function refusal(code: string) { return Object.assign(new Error(code), { code }); }

function fakeRpc(replies: Record<string, Reply>) {
  const calls: Call[] = [];
  return {
    calls,
    request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
      calls.push({ method, payload });
      if (!(method in replies)) throw refusal('UNKNOWN_METHOD');
      const reply = replies[method];
      const value = typeof reply === 'function' ? (reply as (p: Record<string, unknown>) => unknown)(payload) : reply;
      if (value instanceof Error) throw value;
      return structuredClone(value);
    }),
  };
}

function draw(address: Address, replies: Record<string, Reply>, o: { viewer?: boolean; role?: string; language?: Language } = {}) {
  const rpc = fakeRpc(replies);
  const mod = firmPlaces.find((m) => m.handles(address));
  if (!mod) throw new Error('no module');
  const navigate = vi.fn();
  const props: PlaceRenderProps = {
    address, language: o.language ?? 'en', view: 'books', member: { id: 'owner-1', role: o.role ?? 'owner' },
    viewer: o.viewer ?? false, rpc, live: () => true, openReceipt: vi.fn(), navigate,
  };
  const view = render(<TextProvider language={props.language}>{mod.render(props)}</TextProvider>);
  return { ...view, rpc, navigate, user: userEvent.setup() };
}

describe('CA-01 Clients', () => {
  test('the filter goes to the engine, and a count it does not know reads "not known", never 0', async () => {
    const { rpc, user } = draw({ place: 'clients' }, { 'clients.list': LIST });
    const table = await screen.findByRole('table');
    expect(rpc.calls[0]).toEqual({ method: 'clients.list', payload: { filter: 'needs-you' } });
    const demo = within(table).getByRole('rowheader', { name: 'Demo shop' }).closest('tr')!;
    expect(within(demo).getByText('not known')).toBeTruthy();
    expect(within(demo).queryByText('0')).toBeNull();
    expect(within(demo).getByText('GSTR-3B')).toBeTruthy();
    const second = within(table).getByRole('rowheader', { name: 'Second shop' }).closest('tr')!;
    expect(within(second).getByText('4')).toBeTruthy();
    expect(within(second).getByText('zz-local-code')).toBeTruthy();
    const invited = within(table).getByRole('rowheader', { name: 'New client' }).closest('tr')!;
    expect(within(invited).getByText('invited, not joined')).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'All' }));
    await waitFor(() => expect(rpc.calls.some((c) => c.method === 'clients.list' && c.payload.filter === 'all')).toBe(true));
  });

  test('"more" asks for the next page with the engine’s cursor and adds its rows', async () => {
    const { rpc, user } = draw({ place: 'clients' }, {
      'clients.list': (p: Record<string, unknown>) => p.cursor === 'next-1'
        ? { ...LIST, rows: [{ ...JOINED, clientId: 'client_4', name: 'Fourth shop' }], nextCursor: null }
        : { ...LIST, nextCursor: 'next-1' },
    });
    await user.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByRole('rowheader', { name: 'Fourth shop' })).toBeTruthy();
    expect(rpc.calls.at(-1)).toEqual({ method: 'clients.list', payload: { filter: 'needs-you', cursor: 'next-1' } });
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  test('opening a client: while the frame cannot switch workspaces, the page says where to open it', async () => {
    const { rpc, user } = draw({ place: 'clients' }, {
      'clients.list': LIST,
      'clients.open': { clientId: 'client_1', workspaceId: 'ws_demo', seat: { seat: 'ca', endsOn: '2026-12-31' } },
    });
    const row = (await screen.findByRole('rowheader', { name: 'Demo shop' })).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Open' }));
    expect(await screen.findByText('Open Demo shop from the workspace menu (CA seat, until 31 Dec 2026).')).toBeTruthy();
    expect(rpc.calls.map((c) => c.method)).toEqual(['clients.list', 'clients.open', 'workspaces.switch']);
    expect(rpc.calls[2]!.payload).toEqual({ id: 'ws_demo' });
  });

  test('a refused open is said in plain words', async () => {
    const { user } = draw({ place: 'clients' }, { 'clients.list': LIST, 'clients.open': refusal('CA_SEAT_ENDED') });
    const row = (await screen.findByRole('rowheader', { name: 'Demo shop' })).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Open' }));
    expect(await screen.findByText(/The seat this client gave has ended/)).toBeTruthy();
  });

  test('send the guide again shows the new code once', async () => {
    const { rpc, user } = draw({ place: 'clients' }, { 'clients.list': LIST, 'clients.guide': { ...GUIDE, clientId: 'client_3' } });
    await user.click(await screen.findByRole('button', { name: 'Send the guide again' }));
    expect(await screen.findByText('ABCDEFGHIJKLMNO2')).toBeTruthy();
    expect(screen.getByText('The code for New client:')).toBeTruthy();
    expect(rpc.calls.find((c) => c.method === 'clients.guide')!.payload).toEqual({ clientId: 'client_3' });
  });

  test('a status card: not an object stays here; the engine’s refusal is said in words', async () => {
    const { rpc, user } = draw({ place: 'clients' }, { 'clients.list': LIST, 'clients.statusImport': refusal('CA_CARD_FORGED'), 'clients.statusFetch': refusal('CA_RELAY_NOT_DEPLOYED') });
    const box = await screen.findByLabelText('Or paste the card');
    await user.click(box);
    await user.paste('[1, 2]');
    await user.click(screen.getByRole('button', { name: 'Add the card' }));
    expect(await screen.findByText(/This is not a status card file/)).toBeTruthy();
    expect(rpc.calls.some((c) => c.method === 'clients.statusImport')).toBe(false);
    await user.clear(box);
    await user.paste(JSON.stringify(CARD));
    await user.click(screen.getByRole('button', { name: 'Add the card' }));
    expect(await screen.findByText(/does not carry the seal of the client’s link code/)).toBeTruthy();
    expect(rpc.calls.find((c) => c.method === 'clients.statusImport')!.payload).toEqual({ card: CARD });
    await user.click(screen.getByRole('button', { name: 'Fetch from the relay' }));
    expect(await screen.findByText('Status reaches the firm by file until a relay is set up.')).toBeTruthy();
  });

  test('a viewer sees the list and no control that changes anything', async () => {
    draw({ place: 'clients' }, { 'clients.list': LIST }, { viewer: true });
    await screen.findByRole('table');
    expect(screen.getByText(/Read only/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add a client' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add the card' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fetch from the relay' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send the guide again' })).toBeNull();
  });

  test('a reply of the wrong shape is never drawn', async () => {
    draw({ place: 'clients' }, { 'clients.list': { ...LIST, rows: [{ ...JOINED, revenue: '120000' }] } });
    expect(await screen.findByText('Code INVALID_REPLY')).toBeTruthy();
    expect(screen.queryByText('Demo shop')).toBeNull();
  });

  test('a reply that arrives after the person left is dropped', async () => {
    const rpc = fakeRpc({ 'clients.list': LIST });
    const mod = firmPlaces.find((m) => m.handles({ place: 'clients' }))!;
    const props: PlaceRenderProps = {
      address: { place: 'clients' }, language: 'en', view: 'books', member: { id: 'o', role: 'owner' }, viewer: false, rpc,
      live: () => false, openReceipt: vi.fn(), navigate: vi.fn(),
    };
    render(<TextProvider language="en">{mod.render(props)}</TextProvider>);
    await waitFor(() => expect(rpc.calls.length).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('not built, not a firm', () => {
  test.each([['UNKNOWN_METHOD'], ['INVALID_REQUEST'], ['METHOD_UNAVAILABLE']])('%s draws the not-built state', async (code) => {
    draw({ place: 'today' }, { 'firm.today': refusal(code) });
    expect(await screen.findByText('Not built yet.')).toBeTruthy();
  });

  test('every firm screen with no engine at all is "not built yet"', async () => {
    for (const address of [{ place: 'work', sub: 'cosign' }, { place: 'work', sub: 'questions' }, { place: 'reports', sub: 'handover' }, { place: 'tools', sub: 'library' },
      { place: 'tools', sub: 'invite' }, { place: 'trust', sub: 'firmname' }, { place: 'trust', sub: 'clientaccess' }, { place: 'work', sub: 'many' }, { place: 'trust', sub: 'cafirm' }] as Address[]) {
      draw(address, {});
      expect(await screen.findByText('Not built yet.'), JSON.stringify(address)).toBeTruthy();
      cleanup();
    }
  });

  test('CA_NOT_A_FIRM is explained', async () => {
    draw({ place: 'work', sub: 'cosign' }, { 'firm.cosign': refusal('CA_NOT_A_FIRM') });
    expect(await screen.findByText('This workspace is not set up as a CA firm’s console.')).toBeTruthy();
  });
});

describe('CA-02 the firm’s Today', () => {
  test('counts by client with "not known" in words; a row opens that client in Clients', async () => {
    const { navigate, user } = draw({ place: 'today' }, {
      'firm.today': {
        month: '2026-09', awaiting: [{ clientId: 'client_1', name: 'Demo shop', cosign: 2, questions: null, total: null }],
        due: [{ clientId: 'client_1', name: 'Demo shop', code: 'tds-deposit', date: '2026-11-07' }], totals: { clients: 3, awaiting: 2 },
      },
    });
    const table = (await screen.findAllByRole('table'))[0]!;
    const row = within(table).getByRole('rowheader', { name: 'Demo shop' }).closest('tr')!;
    expect(within(row).getAllByText('not known')).toHaveLength(2);
    expect(screen.getByText('TDS deposit')).toBeTruthy();
    await user.click(within(row).getByRole('button', { name: 'See in Clients' }));
    expect(navigate).toHaveBeenCalledWith({ place: 'clients', sheet: 'client_1' });
  });
});

describe('CA-09 Invite a client', () => {
  test('the one-time code is shown once, with the guide in a frame that runs nothing', async () => {
    const { rpc, user } = draw({ place: 'tools', sub: 'invite' }, { 'clients.list': LIST, 'clients.add': GUIDE });
    expect(await screen.findByText('New client')).toBeTruthy();
    await user.type(screen.getByLabelText('Client’s name'), 'Ninth shop');
    await user.click(screen.getByRole('button', { name: 'Make the code' }));
    expect(await screen.findByText('ABCDEFGHIJKLMNO2')).toBeTruthy();
    expect(rpc.calls.find((c) => c.method === 'clients.add')!.payload).toEqual({ name: 'Ninth shop' });
    const frame = screen.getByTitle('The guide for Ninth shop');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toBe(GUIDE.guide.html);
    expect(screen.getByRole('button', { name: 'Download the guide' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('ABCDEFGHIJKLMNO2')).toBeNull();
  });
});

describe('CA-06 the same step for many clients', () => {
  test('prepare names the fixed list; send holds each row with the relay explained', async () => {
    const batch = (state: string, result: string, code?: string) => ({
      batchId: 'batch_1', kind: 'gst-guide', month: '2026-09', at: AT, state,
      rows: [{ clientId: 'client_1', name: 'Demo shop', result, ...(code ? { code } : {}) }, { clientId: 'client_3', name: 'New client', result: 'not-joined' }],
    });
    const { rpc, user } = draw({ place: 'work', sub: 'many' }, {
      'firm.many.kinds': { kinds: [{ id: 'gst-guide', needsMonth: true }, { id: 'documents-request', needsMonth: false }] },
      'clients.list': LIST,
      'firm.many.list': { batches: [] },
      'firm.many.prepare': batch('prepared', 'ready'),
      'firm.many.send': batch('held', 'held', 'CA_RELAY_NOT_DEPLOYED'),
    });
    await user.click(await screen.findByRole('radio', { name: 'Send the guide for the GST file' }));
    await user.type(screen.getByLabelText(/^Month/), '2026-09');
    await user.click(await screen.findByRole('checkbox', { name: 'Demo shop' }));
    await user.click(screen.getByRole('checkbox', { name: /New client/ }));
    await user.click(screen.getByRole('button', { name: 'Prepare' }));
    expect(await screen.findByText('This list is fixed: the request runs on exactly these clients.')).toBeTruthy();
    expect(rpc.calls.find((c) => c.method === 'firm.many.prepare')!.payload).toEqual({ kind: 'gst-guide', clientIds: ['client_1', 'client_3'], month: '2026-09' });
    const prepared = document.querySelector('[data-batch="batch_1"]') as HTMLElement;
    expect(within(prepared).getByText(/2 clients/)).toBeTruthy();
    expect(prepared.querySelector('[data-client="client_1"]')!.getAttribute('data-result')).toBe('ready');
    expect(within(prepared).getByText('invited, not joined')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/Status reaches the firm by file until a relay is set up/)).toBeTruthy();
    expect(rpc.calls.find((c) => c.method === 'firm.many.send')!.payload).toEqual({ batchId: 'batch_1' });
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });
});

describe('the client’s "Your CA firm"', () => {
  const linked = { link: { firmName: 'Demo and Co', linkedAt: AT }, consent: null, wording: { version: 'draft-1', approved: false, text: 'Draft: the firm sees status only.' }, lastCardAt: null };

  test('consent pending: the wording awaits the founder, and the draft is said to be a draft', async () => {
    const { rpc, user } = draw({ place: 'trust', sub: 'cafirm' }, { 'castatus.get': linked, 'castatus.consent': refusal('CA_CONSENT_WORDING_PENDING') });
    expect(await screen.findByText(/The wording of this agreement awaits the founder\./)).toBeTruthy();
    expect(screen.getByText(/the draft wording is shown below/)).toBeTruthy();
    expect(screen.getByText('Draft: the firm sees status only.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'I agree' }));
    expect(await screen.findByText(/awaits the founder, so it cannot be agreed to yet/)).toBeTruthy();
    expect(rpc.calls.find((c) => c.method === 'castatus.consent')!.payload).toEqual({ agree: true, version: 'draft-1' });
  });

  test('the card preview lists every field that crosses, with no figures', async () => {
    const { user } = draw({ place: 'trust', sub: 'cafirm' }, {
      'castatus.get': { ...linked, consent: { version: 'draft-1', at: AT } },
      'castatus.card': CARD,
    });
    await user.click(await screen.findByRole('button', { name: 'Make a status card' }));
    const preview = (await screen.findByText('Exactly this crosses to the firm:')).closest('[data-card-preview]') as HTMLElement;
    const fields = [...preview.querySelectorAll('[data-field]')].map((el) => el.getAttribute('data-field'));
    expect(fields).toEqual(['month', 'issuedAt', 'booksReadAt', 'close.bank', 'close.gst', 'close.tds', 'close.tb', 'cosign.meanings', 'cosign.recipes', 'cosign.accountClasses',
      'questions.count', 'questions.oldestAt', 'handover.tb', 'handover.bankRec', 'handover.gstMatch', 'handover.tdsMatch', 'handover.ageing', 'dueNext', 'seats', 'consent', 'workspaceId', 'link', 'mac']);
    expect(preview.querySelector('[data-field="cosign.recipes"] dd')!.textContent).toBe('not known');
    expect(within(preview).getByText('in progress')).toBeTruthy();
    expect(within(preview).getByText('TDS deposit on 7 Nov 2026')).toBeTruthy();
    expect(within(preview).getByText(/No amount, no customer’s name and no document/)).toBeTruthy();
    expect(within(preview).getByText('Saved as chausar-status-2026-09.json.')).toBeTruthy();
    expect(within(preview).getByRole('button', { name: 'Download the card' })).toBeTruthy();
  });

  test('linking checks the code before asking the engine', async () => {
    const { rpc, user } = draw({ place: 'trust', sub: 'cafirm' }, {
      'castatus.get': { link: null, consent: null, wording: { version: 'v1', approved: true, text: null }, lastCardAt: null },
      'castatus.link': { firmName: 'Demo and Co', linkedAt: AT },
    });
    const [firmName] = await screen.findAllByLabelText('The firm’s name');
    await user.type(firmName!, 'Demo and Co');
    await user.type(screen.getByLabelText('Code from the firm’s guide'), 'abcd');
    await user.click(screen.getByRole('button', { name: 'Link the firm' }));
    expect(await screen.findByText(/The code is 16 letters and digits/)).toBeTruthy();
    expect(rpc.calls.some((c) => c.method === 'castatus.link')).toBe(false);
    await user.type(screen.getByLabelText('Code from the firm’s guide'), 'efgh ijkl mno2');
    await user.click(screen.getByRole('button', { name: 'Link the firm' }));
    await waitFor(() => expect(rpc.calls.find((c) => c.method === 'castatus.link')?.payload).toEqual({ firmName: 'Demo and Co', code: 'ABCDEFGHIJKLMNO2' }));
  });

  test('a viewer reads the page and changes nothing', async () => {
    draw({ place: 'trust', sub: 'cafirm' }, { 'castatus.get': linked }, { viewer: true });
    expect(await screen.findByText(/Linked to Demo and Co/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'I agree' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Unlink' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Make a status card' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Make this a CA console' })).toBeNull();
  });
});
