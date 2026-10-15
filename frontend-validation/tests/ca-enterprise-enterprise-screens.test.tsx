// Enterprise screens driven through the enterprise place module with a fake `rpc` whose replies
// follow docs/lanes/ca-enterprise.md ("Enterprise"). All data is synthetic.
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language } from '../../app/ui/src/app/presentation';
import type { PlaceRenderProps } from '../../app/ui/src/places/types';
import { enterprisePlaces } from '../../app/ui/src/screens/ca-enterprise/enterprise/index';
import { enterpriseWords } from '../../app/ui/src/screens/ca-enterprise/enterprise/words';

afterEach(cleanup);

const W = enterpriseWords.en;
type Handler = (payload: Record<string, unknown>) => unknown;
const refuse = (code: string) => () => { throw Object.assign(new Error(code), { code }); };

function fakeRpc(handlers: Record<string, Handler | unknown>) {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  return {
    calls,
    rpc: {
      async request(method: string, payload: Record<string, unknown>) {
        calls.push({ method, payload });
        const h = handlers[method];
        if (h === undefined) throw Object.assign(new Error('unknown'), { code: 'UNKNOWN_METHOD' });
        return typeof h === 'function' ? (h as Handler)(payload) : structuredClone(h);
      },
    },
  };
}

function draw(address: Address, handlers: Record<string, Handler | unknown>, opts: { viewer?: boolean; role?: string; language?: Language } = {}) {
  const fake = fakeRpc(handlers);
  const module = enterprisePlaces.find((m) => m.handles(address));
  if (module === undefined) throw new Error('not handled');
  const props: PlaceRenderProps = {
    address, language: opts.language ?? 'en', view: 'guided', member: { id: 'm-me', role: opts.role ?? 'owner' }, viewer: opts.viewer ?? false,
    rpc: fake.rpc, live: () => true, openReceipt: () => {}, navigate: () => {},
  };
  render(<TextProvider language={props.language}>{module.render(props)}</TextProvider>);
  return fake;
}

const OVERVIEW = {
  subs: [
    { id: 'signin', state: 'needs-founder', code: 'SIGNIN_PROVIDER_NOT_CHOSEN', facts: [{ key: 'provider', value: null }] },
    { id: 'health', state: 'ready', code: null, facts: [{ key: 'sources', value: 'ready' }, { key: 'bench', value: 'not-built' }] },
    { id: 'computers', state: 'ready', code: null, facts: [{ key: 'devices', value: 2 }, { key: 'syncEnabled', value: true }] },
    { id: 'keys', state: 'out-of-service', code: 'KEYS_DOWN', facts: [{ key: 'hsmSlot', value: 'slot-2' }] },
    { id: 'build', state: 'not-built', code: null, facts: [] },
  ],
};

describe('Company', () => {
  test('the bare place shows every sub-place in the Out of service table with its state words and facts', async () => {
    draw({ place: 'company' }, { 'company.overview': OVERVIEW });
    const table = await screen.findByRole('table');
    expect(table.querySelector('caption')?.textContent).toBe(W['ENX-company.table']);
    expect(within(table).getAllByRole('row')).toHaveLength(10);
    const keys = table.querySelector('tr[data-sub="keys"]') as HTMLElement;
    expect(within(keys).getByText(W['ENX-company.state.out-of-service']!)).toBeTruthy();
    expect(within(keys).getByText('hsmSlot')).toBeTruthy(); // an unknown fact key is shown as the key
    const health = table.querySelector('tr[data-sub="health"]') as HTMLElement;
    expect(health.querySelector('[data-state="ready"]')?.textContent).toBe(W['ENX-company.state.ready']);
    expect(health.textContent).toContain(`${W['ENX-fact.sources']}: ${W['ENX-company.state.ready']}`);
    expect(health.textContent).toContain(`${W['ENX-fact.bench']}: ${W['ENX-company.state.not-built']}`);
    const computers = table.querySelector('tr[data-sub="computers"]') as HTMLElement;
    expect(computers.textContent).toContain(`${W['ENX-fact.devices']}: 2`);
    expect(computers.textContent).toContain(`${W['ENX-fact.syncEnabled']}: ${W['ENX-value.yes']}`);
    const signin = table.querySelector('tr[data-sub="signin"]') as HTMLElement;
    expect(signin.textContent).toContain(W['ENX-company.state.needs-founder']);
    expect(signin.textContent).toContain(`${W['ENX-fact.provider']}: ${W['ENX-value.unknown']}`);
    const licence = table.querySelector('tr[data-sub="licence"]') as HTMLElement;
    expect(licence.textContent).toContain(W['ENX-company.notReported']);
  });

  test('a sub-place shows its own entry; Health also shows the whole table', async () => {
    draw({ place: 'company', sub: 'keys' }, { 'company.overview': OVERVIEW });
    expect(await screen.findByText(W['ENX-company.means.out-of-service']!)).toBeTruthy();
    expect(screen.getByText('KEYS_DOWN')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    cleanup();
    draw({ place: 'company', sub: 'health' }, { 'company.overview': OVERVIEW });
    expect(await screen.findByRole('table')).toBeTruthy();
  });

  test('FORBIDDEN, not on, not built and an unreadable reply each draw their own state', async () => {
    draw({ place: 'company' }, { 'company.overview': refuse('FORBIDDEN') });
    expect(await screen.findByText(W['ENX-company.forbidden']!)).toBeTruthy();
    cleanup();
    draw({ place: 'company' }, { 'company.overview': refuse('ENTERPRISE_NOT_ON') });
    expect(await screen.findByText(W['ENX-refusal.notOn']!)).toBeTruthy();
    cleanup();
    draw({ place: 'company' }, {});
    expect(await screen.findByText('Not built yet.')).toBeTruthy();
    cleanup();
    draw({ place: 'company' }, { 'company.overview': { subs: [{ id: 'nowhere', state: 'ready', code: null, facts: [] }] } });
    expect(await screen.findByText(W['ENX-refusal.invalidReply']!)).toBeTruthy();
  });
});

const CHANNELS = { channels: [{ id: 'whatsapp', may: ['brief'], as: 'company' }, { id: 'mail', may: [], as: 'person' }] };

describe('Trust, Channels', () => {
  test('an administrator changes what may be sent and as whom; the exact payload is sent', async () => {
    const user = userEvent.setup();
    const fake = draw({ place: 'trust', sub: 'channels' }, {
      'enterprise.channels.get': CHANNELS,
      'enterprise.channels.set': (p: Record<string, unknown>) => ({ channels: [{ id: p.id, may: p.may, as: p.as }, CHANNELS.channels[1]] }),
    });
    const row = (await screen.findByText('WhatsApp')).closest('li') as HTMLElement;
    await user.click(within(row).getByRole('checkbox', { name: W['ENX-channels.may.approval-link']! }));
    await user.click(within(row).getByRole('radio', { name: W['ENX-channels.as.person']! }));
    await user.click(within(row).getByRole('button', { name: 'Save WhatsApp' }));
    await waitFor(() => expect(fake.calls.some((c) => c.method === 'enterprise.channels.set')).toBe(true));
    expect(fake.calls.find((c) => c.method === 'enterprise.channels.set')!.payload).toEqual({ id: 'whatsapp', may: ['brief', 'approval-link'], as: 'person' });
    expect(await screen.findByText(W['ENX-saved']!)).toBeTruthy();
  });

  test('a viewer reads the channels and gets no control', async () => {
    draw({ place: 'trust', sub: 'channels' }, { 'enterprise.channels.get': CHANNELS }, { viewer: true });
    expect(await screen.findByText('May send: A brief.')).toBeTruthy();
    expect(screen.getByText(W['ENX-channels.mayNothing']!)).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText(W['ENX-readOnly']!)).toBeTruthy();
  });
});

const ACCESS = {
  people: [
    { memberId: 'm-me', name: 'Asha', role: 'owner', branches: ['hq'], persona: 'administrator', grants: null, administers: true, active: true },
    { memberId: 'm-2', name: 'Kiran', role: 'staff', branches: [], persona: null, grants: ['today.today'], administers: false, active: true },
  ],
  personas: ['leader', 'operator', 'specialist', 'administrator', 'auditor', 'developer'],
  grantable: ['today.today', 'trust.reviews', 'books.companies'],
};
const OPEN = { reviewId: 'rv-1', startedAt: '2026-10-14T09:00:00Z', closedAt: null, rows: [
  { memberId: 'm-me', name: 'Asha', role: 'owner', decision: null, decidedBy: null },
  { memberId: 'm-2', name: 'Kiran', role: 'staff', decision: null, decidedBy: null },
] };
const PAST = { reviewId: 'rv-0', startedAt: '2026-07-01T09:00:00Z', closedAt: '2026-07-03T09:00:00Z', rows: [
  { memberId: 'm-2', name: 'Kiran', role: 'staff', decision: 'keep', decidedBy: 'm-me' },
] };

describe('Trust, Reviews', () => {
  test('removing a person sends keep:false and says it waits for the second person', async () => {
    const user = userEvent.setup();
    const fake = draw({ place: 'trust', sub: 'reviews' }, {
      'enterprise.access.list': ACCESS,
      'enterprise.access.reviews': { reviews: [OPEN, PAST] },
      'enterprise.access.review.decide': (p: Record<string, unknown>) => ({ ...OPEN, rows: OPEN.rows.map((r) => (r.memberId === p.memberId ? { ...r, decision: p.keep ? 'keep' : 'remove', decidedBy: 'm-me', changeId: 'chg-9' } : r)) }),
      'enterprise.whose.get': { list: 'trust.reviews', whose: 'everyone' },
    });
    await user.click(await screen.findByRole('button', { name: 'Remove Kiran' }));
    await waitFor(() => expect(fake.calls.some((c) => c.method === 'enterprise.access.review.decide')).toBe(true));
    expect(fake.calls.find((c) => c.method === 'enterprise.access.review.decide')!.payload).toEqual({ reviewId: 'rv-1', memberId: 'm-2', keep: false });
    expect(await screen.findByText(W['ENX-reviews.waitsSecond']!)).toBeTruthy();
    expect(screen.getByText('Removed, by Asha')).toBeTruthy();
    expect(screen.getByText('Kept 1, removed 0')).toBeTruthy();
  });

  test('reviewing yourself is refused in words', async () => {
    const user = userEvent.setup();
    draw({ place: 'trust', sub: 'reviews' }, {
      'enterprise.access.list': ACCESS, 'enterprise.access.reviews': { reviews: [OPEN] }, 'enterprise.access.review.decide': refuse('ENTERPRISE_REVIEW_SELF'),
    });
    await user.click(await screen.findByRole('button', { name: 'Keep Asha' }));
    expect(await screen.findByText(W['ENX-refusal.reviewSelf']!)).toBeTruthy();
  });

  test('grants, persona and administers are sent exactly; the last administrator is refused in words', async () => {
    const user = userEvent.setup();
    const fake = draw({ place: 'trust', sub: 'reviews' }, {
      'enterprise.access.list': ACCESS, 'enterprise.access.reviews': { reviews: [] }, 'enterprise.access.set': refuse('ENTERPRISE_LAST_ADMINISTRATOR'),
    });
    const kiran = (await screen.findByText('Kiran')).closest('li') as HTMLElement;
    await user.click(within(kiran).getByRole('radio', { name: 'Operator' }));
    await user.click(within(kiran).getByRole('checkbox', { name: 'trust.reviews' }));
    await user.click(within(kiran).getByRole('button', { name: 'Save Kiran' }));
    await waitFor(() => expect(fake.calls.some((c) => c.method === 'enterprise.access.set')).toBe(true));
    expect(fake.calls.find((c) => c.method === 'enterprise.access.set')!.payload).toEqual({ memberId: 'm-2', persona: 'operator', grants: ['today.today', 'trust.reviews'], administers: false });
    expect(await screen.findByText(W['ENX-refusal.lastAdmin']!)).toBeTruthy();
    expect(screen.getByRole('button', { name: W['ENX-reviews.start']! })).toBeTruthy();
  });

  test('Whose is kept per list: choosing Mine is sent and filters to rows I decided', async () => {
    const user = userEvent.setup();
    const decided = { ...OPEN, rows: [{ ...OPEN.rows[0]!, decision: 'keep', decidedBy: 'm-other' }, { ...OPEN.rows[1]!, decision: 'keep', decidedBy: 'm-me' }] };
    const fake = draw({ place: 'trust', sub: 'reviews' }, {
      'enterprise.access.list': ACCESS, 'enterprise.access.reviews': { reviews: [decided] },
      'enterprise.whose.get': { list: 'trust.reviews', whose: 'everyone' }, 'enterprise.whose.set': (p: Record<string, unknown>) => p,
    });
    const open = await screen.findByText(/^Open since/);
    const list = open.nextElementSibling as HTMLElement;
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    await user.click(screen.getByRole('radio', { name: 'Mine' }));
    expect(fake.calls.find((c) => c.method === 'enterprise.whose.set')!.payload).toEqual({ list: 'trust.reviews', whose: 'mine' });
    await waitFor(() => expect(within(open.nextElementSibling as HTMLElement).getAllByRole('listitem')).toHaveLength(1));
  });

  test('a seat that does not administer sees the forbidden words', async () => {
    draw({ place: 'trust', sub: 'reviews' }, { 'enterprise.access.list': refuse('FORBIDDEN') }, { role: 'staff' });
    expect(await screen.findByText(W['ENX-reviews.forbidden']!)).toBeTruthy();
  });
});

describe('Trust, Holds', () => {
  test('placing a hold shows the refusal plainly', async () => {
    const user = userEvent.setup();
    const fake = draw({ place: 'trust', sub: 'holds' }, { 'enterprise.holds.list': { holds: [], enforced: false }, 'enterprise.holds.place': refuse('ENTERPRISE_HOLDS_NOT_ENFORCED') });
    expect(await screen.findByText(W['ENX-holds.none']!)).toBeTruthy();
    await user.type(screen.getByLabelText(W['ENX-holds.what']!), 'Supplier dispute, 2025');
    await user.click(screen.getByRole('button', { name: W['ENX-holds.place']! }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Legal holds are recorded only once the engine enforces them; it does not yet.');
    expect(fake.calls.find((c) => c.method === 'enterprise.holds.place')!.payload).toEqual({ what: 'Supplier dispute, 2025' });
  });
});

describe('Trust, Edition', () => {
  test('the owner turns the company version on, and is told it opens there next time', async () => {
    const user = userEvent.setup();
    const fake = draw({ place: 'trust', sub: 'edition' }, {
      'caent.shell': { kind: 'desktop', administers: false, allowed: null, views: null, home: null },
      'enterprise.setup': (p: Record<string, unknown>) => ({ kind: p.on ? 'enterprise' : 'desktop' }),
    });
    expect(await screen.findByText(W['ENX-edition.is.desktop']!)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: W['ENX-edition.turnOn']! }));
    expect(await screen.findByText(W['ENX-edition.reopenOn']!)).toBeTruthy();
    expect(fake.calls.find((c) => c.method === 'enterprise.setup')!.payload).toEqual({ on: true });
    expect(screen.getByRole('button', { name: W['ENX-edition.turnOff']! })).toBeTruthy();
  });

  test('a CA firm workspace refuses in words; a non-owner gets no control', async () => {
    const user = userEvent.setup();
    draw({ place: 'trust', sub: 'edition' }, { 'caent.shell': { kind: 'desktop', administers: false, allowed: null, views: null, home: null }, 'enterprise.setup': refuse('ENTERPRISE_SHELL_TAKEN') });
    await user.click(await screen.findByRole('button', { name: W['ENX-edition.turnOn']! }));
    expect(await screen.findByText(W['ENX-refusal.shellTaken']!)).toBeTruthy();
    cleanup();
    draw({ place: 'trust', sub: 'edition' }, { 'caent.shell': { kind: 'enterprise', administers: true, allowed: null, views: null, home: null } }, { role: 'cofounder' });
    expect(await screen.findByText(W['ENX-edition.ownerOnly']!)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Books, Companies and Trust, Teams', () => {
  test('the group, the switch, the honest eliminations line and group.set rows', async () => {
    const user = userEvent.setup();
    const GROUP = { companies: [{ id: 'br-1', name: 'North Ltd' }], chosen: 'all', combined: { eliminations: 'not-built' } };
    const fake = draw({ place: 'books', sub: 'companies' }, {
      'enterprise.companies': GROUP,
      'enterprise.company.set': (p: Record<string, unknown>) => ({ ...GROUP, chosen: p.id }),
      'enterprise.group.set': (p: Record<string, unknown>) => ({ ...GROUP, companies: p.companies }),
    });
    expect(await screen.findByText(W['ENX-companies.eliminations']!)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Choose North Ltd' }));
    await waitFor(() => expect(fake.calls.find((c) => c.method === 'enterprise.company.set')?.payload).toEqual({ id: 'br-1' }));
    await user.click(screen.getByRole('button', { name: W['ENX-companies.addRow']! }));
    const ids = screen.getAllByLabelText(W['ENX-companies.branch']!);
    const names = screen.getAllByLabelText(W['ENX-companies.name']!);
    await user.type(ids[1]!, 'br-2');
    await user.type(names[1]!, 'South Ltd');
    await user.click(screen.getByRole('button', { name: W['ENX-companies.save']! }));
    await waitFor(() => expect(fake.calls.some((c) => c.method === 'enterprise.group.set')).toBe(true));
    expect(fake.calls.find((c) => c.method === 'enterprise.group.set')!.payload).toEqual({ companies: [{ id: 'br-1', name: 'North Ltd' }, { id: 'br-2', name: 'South Ltd' }] });
  });

  test('ENTERPRISE_NOT_ON on Companies; teams are saved as a whole list', async () => {
    draw({ place: 'books', sub: 'companies' }, { 'enterprise.companies': refuse('ENTERPRISE_NOT_ON') });
    expect(await screen.findByText(W['ENX-refusal.notOn']!)).toBeTruthy();
    cleanup();
    const user = userEvent.setup();
    const fake = draw({ place: 'trust', sub: 'teams' }, {
      'enterprise.teams.list': { teams: [{ id: 't-1', name: 'Payables', memberIds: ['m-me'] }] },
      'enterprise.access.list': ACCESS,
      'enterprise.teams.set': (p: Record<string, unknown>) => ({ teams: (p.teams as { name: string; memberIds: string[] }[]).map((x, i) => ({ id: `t-${i + 1}`, ...x })) }),
    });
    const kiranBox = await screen.findByRole('checkbox', { name: 'Kiran' });
    await user.click(kiranBox);
    await user.click(screen.getByRole('button', { name: W['ENX-teams.save']! }));
    await waitFor(() => expect(fake.calls.some((c) => c.method === 'enterprise.teams.set')).toBe(true));
    expect(fake.calls.find((c) => c.method === 'enterprise.teams.set')!.payload).toEqual({ teams: [{ id: 't-1', name: 'Payables', memberIds: ['m-me', 'm-2'] }] });
    expect(await screen.findByText(W['ENX-saved']!)).toBeTruthy();
  });

  test('Hindi draws the same screen in Hindi', async () => {
    draw({ place: 'trust', sub: 'holds' }, { 'enterprise.holds.list': { holds: [], enforced: false } }, { language: 'hi' });
    expect(await screen.findByText(enterpriseWords.hi['ENX-holds.none']!)).toBeTruthy();
  });
});
