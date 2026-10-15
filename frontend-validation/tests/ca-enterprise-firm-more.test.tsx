// CA console screens CA-04, CA-05, CA-07, CA-08, CA-10, CA-11 and Hindi, with a fake `rpc`.
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
type Call = { method: string; payload: Record<string, unknown> };
function refusal(code: string) { return Object.assign(new Error(code), { code }); }

function draw(address: Address, replies: Record<string, unknown>, o: { viewer?: boolean; role?: string; language?: Language } = {}) {
  const calls: Call[] = [];
  const rpc = {
    request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
      calls.push({ method, payload });
      if (!(method in replies)) throw refusal('UNKNOWN_METHOD');
      const value = replies[method];
      if (value instanceof Error) throw value;
      return structuredClone(value);
    }),
  };
  const mod = firmPlaces.find((m) => m.handles(address))!;
  const props: PlaceRenderProps = {
    address, language: o.language ?? 'en', view: 'guided', member: { id: 'owner-1', role: o.role ?? 'owner' },
    viewer: o.viewer ?? false, rpc, live: () => true, openReceipt: vi.fn(), navigate: vi.fn(),
  };
  render(<TextProvider language={props.language}>{mod.render(props)}</TextProvider>);
  return { calls, user: userEvent.setup() };
}

const HANDOVER = { tb: 'ready', bankRec: 'not-ready', gstMatch: 'refused', tdsMatch: 'ready', ageing: 'ready' };

describe('per-client lists', () => {
  test('CA-04 hand-over: a checklist per client, export said to happen inside the client, opened inside it', async () => {
    const { calls, user } = draw({ place: 'reports', sub: 'handover' }, {
      'firm.handover': { month: '2026-09', rows: [{ clientId: 'c1', name: 'Demo shop', handover: HANDOVER }, { clientId: 'c2', name: 'Other', handover: null }] },
      'clients.open': refusal('CA_CLIENT_NOT_ASSIGNED'),
    });
    expect(await screen.findByText('Bank reconciliation: not ready')).toBeTruthy();
    expect(screen.getByText('GST match: file refused')).toBeTruthy();
    expect(screen.getByText(/Export to Excel and to a file Tally can import happen there too/)).toBeTruthy();
    expect(screen.getByText('Not known: no status card yet.')).toBeTruthy();
    const item = document.querySelector('[data-client="c1"]') as HTMLElement;
    await user.click(within(item).getByRole('button', { name: 'Open inside the client' }));
    expect(await screen.findByText(/You are not one of the people who may open this client/)).toBeTruthy();
    expect(calls.at(-1)).toEqual({ method: 'clients.open', payload: { clientId: 'c1' } });
  });

  test('CA-05 to co-sign and CA-10 questions show counts and "not known"', async () => {
    draw({ place: 'work', sub: 'cosign' }, { 'firm.cosign': { rows: [{ clientId: 'c1', name: 'Demo shop', meanings: 3, recipes: null, accountClasses: 0 }] } });
    const row = (await screen.findByRole('rowheader', { name: 'Demo shop' })).closest('tr')!;
    expect(within(row).getByText('3')).toBeTruthy();
    expect(within(row).getByText('not known')).toBeTruthy();
    expect(within(row).getByText('0')).toBeTruthy();
    cleanup();
    draw({ place: 'work', sub: 'questions' }, { 'firm.questions': { rows: [{ clientId: 'c1', name: 'Demo shop', count: 2, oldestAt: '2026-10-01T05:00:00Z' }] } });
    const q = (await screen.findByRole('rowheader', { name: 'Demo shop' })).closest('tr')!;
    expect(within(q).getByText('1 Oct 2026')).toBeTruthy();
  });
});

describe('CA-07 library', () => {
  test('a body with values is refused with the structure rule in words', async () => {
    const { calls, user } = draw({ place: 'tools', sub: 'library' }, {
      'firm.library.list': { items: [{ id: 'lib_1', kind: 'check', title: 'GST match check', addedAt: AT }] },
      'firm.library.add': refusal('CA_LIBRARY_NOT_STRUCTURE'),
    });
    expect(await screen.findByText('GST match check')).toBeTruthy();
    await user.type(screen.getByLabelText('Title'), 'Recipe');
    await user.click(screen.getByLabelText('Structure (JSON)'));
    await user.paste('{"gstin":"27AAAAA0000A1Z5"}');
    await user.click(screen.getByRole('button', { name: 'Add to the library' }));
    expect(await screen.findByText(/The library keeps structure only: no client’s data\. Take out/)).toBeTruthy();
    expect(calls.find((c) => c.method === 'firm.library.add')!.payload).toEqual({ kind: 'recipe', title: 'Recipe', body: { gstin: '27AAAAA0000A1Z5' } });
  });
});

describe('CA-08 who opens which client', () => {
  test('states the rule and narrows to chosen clients', async () => {
    const { calls, user } = draw({ place: 'trust', sub: 'clientaccess' }, {
      'firm.people.list': { people: [{ memberId: 'm2', name: 'Kiran', role: 'staff', clients: '*' }] },
      'clients.list': { month: '2026-09', rows: [{ clientId: 'c1', name: 'Demo shop', state: 'joined', booksReadAt: null, close: null, awaiting: null, dueNext: null, cardAt: null, stale: false, seat: null }], counts: { needsYou: 0, closeNotDone: 0, all: 1 }, nextCursor: null },
      'firm.people.assign': { memberId: 'm2', clients: ['c1'] },
    });
    expect(await screen.findByText(/A client’s owner gives the seat; the firm cannot add itself to a client\./)).toBeTruthy();
    expect(screen.getByText('May open every client.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.click(screen.getByRole('radio', { name: 'Chosen clients' }));
    await user.click(screen.getByRole('checkbox', { name: 'Demo shop' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'firm.people.assign')?.payload).toEqual({ memberId: 'm2', clients: ['c1'] }));
  });
});

describe('CA-11 the firm’s name', () => {
  test('the price per client file is marked planned; a staff seat cannot change the name', async () => {
    draw({ place: 'trust', sub: 'firmname' }, { 'firm.status': { firm: { name: 'Demo and Co', reportName: null, pricing: 'planned' } } }, { role: 'staff' });
    expect(await screen.findByText('Per client file. Planned.')).toBeTruthy();
    expect(screen.getByText('Only the owner or a cofounder changes this.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  test('saving sends both names', async () => {
    const { calls, user } = draw({ place: 'trust', sub: 'firmname' }, {
      'firm.status': { firm: { name: 'Demo and Co', reportName: null, pricing: 'planned' } },
      'firm.name.set': { firm: { name: 'Demo and Co', reportName: 'Demo & Co, Chartered Accountants', pricing: 'planned' } },
    });
    await user.type(await screen.findByLabelText('Name on reports'), 'Demo & Co, Chartered Accountants');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(calls.find((c) => c.method === 'firm.name.set')!.payload).toEqual({ name: 'Demo and Co', reportName: 'Demo & Co, Chartered Accountants' });
  });
});

describe('Hindi', () => {
  test('the firm’s Today reads in Hindi, with "not known" in words', async () => {
    draw({ place: 'today' }, {
      'firm.today': { month: '2026-09', awaiting: [{ clientId: 'c1', name: 'Demo shop', cosign: null, questions: 1, total: null }], due: [], totals: { clients: 1, awaiting: 1 } },
    }, { language: 'hi' });
    expect(await screen.findByText('फ़र्म के लिए क्या प्रतीक्षा में है')).toBeTruthy();
    expect(screen.getAllByText('पता नहीं').length).toBe(2);
  });
});
