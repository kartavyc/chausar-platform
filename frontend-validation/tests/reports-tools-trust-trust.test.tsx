// Trust screens (TR-01..TR-15) driven through their place modules with a fake `rpc` whose
// replies follow section 1.2 of docs/lanes/reports-tools-trust.md. All data is synthetic.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language, View } from '../../app/ui/src/app/presentation';
import type { PlaceRenderProps } from '../../app/ui/src/places/types';
import { trustPlaces } from '../../app/ui/src/screens/trust/index';
import { COMMON, DELETION, KEEP, NETWORK, PEOPLE, RECORD, RULES, SEE, SEND, SHARING, VAULT } from '../../app/ui/src/screens/trust/words';
import { validateDeletion } from '../../app/ui/src/screens/trust/validate';
import { words as laneWords } from '../../app/ui/src/text/lanes/reports-tools-trust';

afterEach(cleanup);

const AT = '2026-10-14T09:00:00Z';

const SHARE_BATCH = {
  id: 'sharebatch_1', at: AT, consentId: 'shareconsent_0', previewId: 'sharepreview_0', mode: 'test-inbox', boxes: ['setup-shapes'], decisionIds: ['decision_0'],
  bytes: '{"schema":"chausar.learning.v1","boxes":["setup-shapes"],"events":[\n{"choice":"accepted","kind":"mapping"}\n]}', digest: 'dg-batch', size: 2048, count: 400,
  status: 'sent', reference: 'test-inbox:sharebatch_1',
};
const SHARE_PREVIEW = {
  id: 'sharepreview_1', at: AT, memberId: 'owner-1', epoch: 1, boxes: ['setup-shapes'], decisionIds: ['d1', 'd2'], sourceIds: [], digest: 'dg-file', size: 3, count: 2,
  blocked: [], bytes: '{"schema":"chausar.learning.v1"}\n<b>not markup</b>', names: 0, amounts: 0, publicName: null, authors: [{ memberId: 'owner-1', count: 2 }], status: {},
};
const SAMPLE = {
  id: 'sample_1', at: AT, memberId: 'owner-1', label: 'Sample', status: 'blocked', cleaned: 'Name,Notes\nName A,call 98765 43210',
  hits: [{ line: 2, column: 'Notes', code: 'PHONE' }], replaced: { Name: 1 }, upload: 'Uploading samples waits until the receiving service has been reviewed. Nothing is uploaded.',
};

const FIXTURES: Record<string, unknown> = {
  'trustx.rules': {
    see: { allSources: false, allowed: 3, refused: 1 }, send: { level: 'shape', localOnly: false }, keep: { days: 365 }, do: { preset: 'ask-everything' },
    leftToday: { date: '2026-10-14', items: [
      { destination: 'Cloud A', kind: 'model', count: 4, bytes: 2048, stopped: false },
      { destination: 'Relay', kind: 'sync', count: 1, bytes: null, stopped: true },
    ] },
    canChange: true, ownerOnly: ['send', 'sharing', 'seats'],
  },
  'trustx.markings': {
    kinds: ['personal', 'financial', 'confidential'],
    marks: [
      { id: 'm1', kind: 'financial', target: { type: 'source', sourceId: 'bank-hdfc' }, auto: true, by: 'system', at: AT },
      { id: 'm2', kind: 'personal', target: { type: 'field', sourceId: 'sales', field: 'phone' }, auto: false, by: 'Asha', at: AT },
    ],
    seats: [{ seat: 'accountant', sees: { personal: false, financial: true, confidential: false } }],
    where: { source: 'books/sources', record: 'books/customers', field: 'books/meanings' },
  },
  'sources.list': [{ sourceId: 'sales', fileName: 'sales.csv' }, { sourceId: 'bank-hdfc', name: 'HDFC statement' }, { sourceId: 'sales', fileName: 'sales.csv' }],
  'trust.get': { allowedSources: ['*'], send: 'shape' },
  'trustx.sendLevels': {
    current: 'shape', localOnly: false, financialRoutes: ['local-llama'], synthetic: true,
    levels: [
      { id: 'nothing', headings: [], rows: [], memory: 'No memory lines are sent.', question: 'Your question is not sent.' },
      { id: 'shape', headings: ['Customer', 'Amount'], rows: [['CUSTOMER_1', 'number']], memory: 'Memory headings only.', question: 'Your question is sent as typed.' },
      { id: 'samples', headings: ['Customer', 'Amount'], rows: [['CUSTOMER_1', '1200'], ['CUSTOMER_2', '900']], memory: 'A few memory lines.', question: 'Your question is sent as typed.' },
    ],
    voice: { on: false, note: 'Voice is off.' },
  },
  'trustx.pendingChanges': { items: [] },
  'trustx.keep': {
    kinds: [{ kind: 'Books', days: null, note: 'Your books.' }, { kind: 'Model answers', days: 90, note: '' }],
    inventory: [{ path: 'vault/state.enc', bytes: 10240, what: 'The locked books' }],
  },
  // TR-05 Do reads jobs-ext (see reports-tools-trust-trust-do.test.tsx for the screen itself).
  'jobsx.autonomy': {
    master: false, preset: 'custom',
    kinds: [{ kind: 'local.draft-note', title: 'Draft a note', impact: 'reversible', switchable: true, on: true, dailyCount: 20, usedToday: 3, agreement: { approved: 9, declined: 1 } }],
    alwaysWaits: { intro: 'Anything that cannot be undone, and in particular:', items: ['money', 'messages to outsiders'] },
    caps: { activeJobCap: 10, failureLimit: 3, backgroundMode: false, backgroundAsked: false, reminderPerCustomerPerDay: 1, reminderPerDay: 20, groupMax: 10, autoReviewMinutes: 0 },
  },
  'trustx.seats': {
    seats: [
      { memberId: 'owner-1', name: 'Asha', seat: 'owner', limits: ['Everything'], limitCodes: ['everything'], endsOn: null, ended: false, removedOn: null, active: true, you: true },
      { memberId: 'acc-1', name: 'Kiran', seat: 'accountant', limits: ['Reads everything not marked away', 'Cannot approve money'], limitCodes: ['reads-unmarked', 'no-approve-money'], endsOn: null, ended: false, removedOn: null, active: true, you: false },
      { memberId: 'ca-1', name: 'R. Mehta', seat: 'ca', limits: ['Reads and exports'], limitCodes: ['reads-exports-until'], endsOn: '2026-10-01', ended: true, removedOn: null, active: false, you: false },
      { memberId: 'staff-1', name: 'Ravi', seat: 'staff', limits: ['Adds entries'], limitCodes: ['adds-entries'], endsOn: null, ended: false, removedOn: '2026-10-02', active: false, you: false },
    ],
    templates: [],
  },
  'sync.status': { enabled: false, deviceId: 'd1', transport: null, mode: 'single-writer', experimental: true, writerAdmission: { readonly: true, available: false } },
  'trustx.models': {
    routes: [
      { id: 'local', kind: 'local', label: 'On this computer', health: 'ready', order: 2, terms: null, lastAnswerCostMinor: null },
      { id: 'cloud-a', kind: 'cloud', label: 'Cloud A', health: 'signed-out', order: 1,
        terms: { keeps: 'Prompts and answers', keepsFor: '30 days', trains: false, country: 'United States', termsUrl: 'https://example.invalid/terms', readOn: '2026-09-01' },
        lastAnswerCostMinor: '250' },
    ],
    spendThisMonthMinor: '12550', monthlyCapMinor: '100000', voice: { provider: null, minutesThisMonth: 0 },
  },
  'trustx.network': {
    items: [
      { id: 'n2', at: AT, kind: 'plugin', destination: 'plugin.example', why: 'Read outside text first', bytes: 512, outcome: 'waiting', pluginId: 'gst-helper', waitingContent: '<script>alert(1)</script> total 1200' },
      { id: 'n1', at: AT, kind: 'model', destination: 'Cloud A', why: 'Answer a question', bytes: 2048, outcome: 'allowed' },
    ],
    canary: { planted: true, alert: { at: AT, callId: 'call-77' } },
  },
  'trustx.record': {
    items: [{ seq: 2, at: AT, who: 'Asha', what: 'Changed Send to shape only', rule: 'Only the owner changes Send', computer: 'Office laptop' }],
    head: { hash: 'abcdef0123456789', short: 'AB12-CD34', at: AT, count: 2 }, limit: 500,
  },
  'trustx.verifyRecord': { verified: false, brokenAt: 7, head: 'AB12-CD34' },
  'trustx.sharing': {
    on: true, intake: { open: false, words: 'Intake is not open.' }, preview: { digest: 'sha256:aa', bytes: 4096, events: 12 },
    batches: [{ id: 'b1', at: AT, bytes: 2048, events: 400 }], totals: { events: 412, names: 0, amounts: 0 }, withdrawnAt: AT,
  },
  'trustx.cleanSample': { cleaned: 'Call [PHONE] today', hits: [{ line: 1, kind: 'phone' }], uploaded: false },
  'trustx.hosted': {
    blind: 'Hosted backup and sync are blind: the server holds only locked files and no key.',
    notBlind: 'Hosted jobs are not blind: the server holds a key for that one job while it works.',
    jobs: [{ id: 'j1', name: 'Weekly brief', on: false }], plan: 'planned-not-available', keeps: 'Kept for one year, with no business content.',
  },
  'trustx.agreements': {
    notice: { version: '1', en: 'English privacy notice.', hi: 'हिंदी निजता सूचना।' },
    items: [{ id: 'ag1', person: 'Asha', purpose: 'Share structure', at: AT, withdrawnAt: null }],
  },
  'trustx.vault': {
    backups: [{ file: 'backup-1.chausar', at: AT, bytes: 1048576, testRestore: 'passed', testedAt: AT }],
    lock: { idleMinutes: 15, deviceCheck: true }, disk: { freeBytes: 5000000, totalBytes: 10000000 },
    limit: 'A program running as you on this computer can read what you can read. The passphrase limits this; it does not remove it.',
    recoveryContact: { name: null, experimental: true }, version: '0.1.0-preview.1',
  },
  'trustx.deletions': { items: [] },
  // learning-ext (platform/runtime/learning-ext/sharing.ts and log.ts)
  'learningx.intakeStatus': {
    open: false, mode: 'closed', sharingSwitch: true, label: 'Sharing is not open yet. Nothing is sent.',
    boxes: [{ box: 'setup-shapes', open: true }, { box: 'corrections', open: true },
      { box: 'account-words', open: false, reason: 'Waits for the founder switch and a reviewed consent text.', shown: false },
      { box: 'question-shapes', open: false, reason: 'Waits for the founder switch and a reviewed consent text.', shown: true }],
  },
  'learningx.batches': { items: [SHARE_BATCH], shared: { events: 412, names: 0, amounts: 0 }, credits: { publicName: null, latest: null } },
  'learningx.batch': SHARE_BATCH,
  'learningx.log': { items: [{ id: 'decision_1', at: AT, origin: 'lane', event: { kind: 'mapping', choice: 'accepted', reason: 'library-match' }, sourceIds: [], refs: [] }], total: 1, next: null },
  'learningx.outbox': { items: [] },
};

const SERVICE = { platform: 'linux', mechanism: 'linux-systemd-user', installed: false, running: false, unitPath: '/home/synthetic/.config/systemd/user/chausar-background.service' };

const REPORT = {
  id: 'del-1', at: AT, sourceId: 'sales',
  rows: [{ place: 'Books', code: 'books-new', state: 'deleted', reason: 'Checked gone.' }, { place: 'AI provider', code: 'ai-provider', state: 'not-possible', reason: 'Kept for 30 days by the provider.' }],
};

type Reply = unknown | ((payload: Record<string, unknown>) => unknown);
function refusal(code: string) { return Object.assign(new Error(code), { code }); }

function fakeRpc(extra: Record<string, Reply> = {}, base: Record<string, Reply> = FIXTURES) {
  const replies: Record<string, Reply> = { ...base, ...extra };
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const request = vi.fn(async (method: string, payload: Record<string, unknown>) => {
    calls.push({ method, payload });
    if (!(method in replies)) throw refusal('UNKNOWN_METHOD');
    const r = replies[method];
    const value = typeof r === 'function' ? (r as (p: Record<string, unknown>) => unknown)(payload) : r;
    if (value instanceof Error) throw value;
    return structuredClone(value);
  });
  return { request, calls, of: (method: string) => calls.filter((c) => c.method === method) };
}
type Fake = ReturnType<typeof fakeRpc>;

function draw(address: Address, o: { rpc?: Fake; language?: Language; view?: View; role?: string; viewer?: boolean; memberId?: string } = {}) {
  const rpc = o.rpc ?? fakeRpc();
  const mod = trustPlaces.find((m) => m.handles(address));
  if (!mod) throw new Error('no module');
  const navigate = vi.fn(), openReceipt = vi.fn();
  const props: PlaceRenderProps = {
    address, language: o.language ?? 'en', view: o.view ?? 'guided', member: { id: o.memberId ?? 'owner-1', role: o.role ?? 'owner' },
    viewer: o.viewer ?? false, rpc, live: () => true, openReceipt, navigate,
  };
  const view = render(<TextProvider language={props.language}>{mod.render(props)}</TextProvider>);
  return { ...view, rpc, navigate, user: userEvent.setup() };
}

const at = (sub?: string, sheet?: string): Address => {
  const a: Address = { place: 'trust' };
  if (sub !== undefined) a.sub = sub;
  if (sheet !== undefined) a.sheet = sheet;
  return a;
};

describe('every sub-place and sheet draws ready data in both languages', () => {
  const pages: [Address, keyof typeof COMMON.en][] = [
    [at(), 'rules'], [at('rules'), 'rules'], [at('people'), 'people'], [at('access'), 'access'], [at('models'), 'models'], [at('network'), 'network'],
    [at('record'), 'record'], [at('sharing'), 'sharing'], [at('vault'), 'vault'], [at('markings'), 'markings'], [at('retention'), 'retention'],
  ];
  for (const language of ['en', 'hi'] as const) {
    for (const [address, key] of pages) {
      test(`${address.sub ?? '(bare)'} in ${language}`, async () => {
        draw(address, { language });
        expect(await screen.findByRole('heading', { level: 1, name: COMMON[language][key] })).toBeTruthy();
        await waitFor(() => expect(screen.queryByText(language === 'en' ? 'Reading. What was known last time is shown.' : 'पढ़ रहा है। पिछली बार जो पता था, वह दिख रहा है।')).toBeNull());
        expect(screen.queryByText(/INVALID_REPLY/)).toBeNull();
      });
    }
    const sheets: [Address, string][] = [
      [at('rules', 'see'), COMMON[language].see], [at('rules', 'send'), COMMON[language].send], [at('rules', 'keep'), COMMON[language].keep],
      [at('rules', 'do'), COMMON[language].do], [at('people', 'invite'), PEOPLE[language].inviteTitle], [at('vault', 'delete'), DELETION[language].title],
      [at('network', 'n2'), NETWORK[language].waitingTitle],
    ];
    for (const [address, title] of sheets) {
      test(`sheet ${address.sub}?sheet=${address.sheet} in ${language}`, async () => {
        draw(address, { language });
        expect(await screen.findByRole('heading', { level: 2, name: title })).toBeTruthy();
      });
    }
    test(`channels is not built yet in ${language}`, async () => {
      draw(at('channels'), { language });
      expect(await screen.findByText(language === 'en' ? 'Not built yet.' : 'अभी बना नहीं है।')).toBeTruthy();
    });
  }
  test('Hindi sentences come from the Hindi catalogue', async () => {
    draw(at('rules'), { language: 'hi' });
    expect(await screen.findByText(RULES.hi.leftTitle)).toBeTruthy();
    expect(screen.getByText(new RegExp(RULES.hi.foot.slice(0, 20)))).toBeTruthy();
  });
});

describe('TR-01 Rules', () => {
  test('four rows open in place and as a full page; the drawing labels each destination', async () => {
    const { user, navigate, container } = draw(at('rules'));
    expect(await screen.findByText('Reads 3 sources, refuses 1.')).toBeTruthy();
    expect(screen.getByText(RULES.en.sendShape)).toBeTruthy();
    expect(screen.getByText('Kept for 365 days.')).toBeTruthy();
    expect(await screen.findByText(RULES.en['preset.custom'])).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Send/ }));
    expect(screen.getByText(RULES.en.detailSend)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: RULES.en.openPage }));
    expect(navigate).toHaveBeenCalledWith({ place: 'trust', sub: 'rules', sheet: 'send' });
    const svg = container.querySelector('svg[role="img"]');
    expect(svg?.getAttribute('aria-label')).toBe('Lines from this computer to 2 places.');
    expect(within(svg as unknown as HTMLElement).getAllByText('Cloud A: 4').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Relay: 1, stopped').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: RULES.en.linkCustomers }));
    expect(navigate).toHaveBeenCalledWith({ place: 'books', sub: 'customers' });
    await user.click(screen.getByRole('button', { name: RULES.en.linkReport }));
    expect(navigate).toHaveBeenCalledWith({ place: 'trust', sub: 'vault', sheet: 'delete' });
  });

  test('nothing left today is said in words', async () => {
    const rules = structuredClone(FIXTURES['trustx.rules']) as { leftToday: { items: unknown[] } };
    rules.leftToday.items = [];
    draw(at('rules'), { rpc: fakeRpc({ 'trustx.rules': rules }) });
    expect(await screen.findByText(RULES.en.leftNone)).toBeTruthy();
  });

  test('a staff seat reads "Only the owner can change this." on Send', async () => {
    const { user } = draw(at('rules'), { role: 'staff' });
    await user.click(await screen.findByRole('button', { name: /Send/ }));
    expect(screen.getByText(COMMON.en.ownerOnly)).toBeTruthy();
  });

  test('not built, failed and an invalid reply', async () => {
    draw(at('rules'), { rpc: fakeRpc({}, {}) });
    expect(await screen.findByText('Not built yet.')).toBeTruthy();
    cleanup();
    draw(at('rules'), { rpc: fakeRpc({ 'trustx.rules': refusal('DISK_FULL') }) });
    expect(await screen.findByText('Code DISK_FULL')).toBeTruthy();
    cleanup();
    draw(at('rules'), { rpc: fakeRpc({ 'trustx.rules': { see: {} } }) });
    expect(await screen.findByText('Code INVALID_REPLY')).toBeTruthy();
    cleanup();
    draw(at('rules'), { rpc: fakeRpc({ 'trustx.rules': refusal('VAULT_LOCKED') }) });
    expect(await screen.findByText('Chausar is locked.')).toBeTruthy();
  });
});

describe('TR-02 See', () => {
  test('sources with No and Yes, where markings are set, auto marks, and seat markings', async () => {
    const rpc = fakeRpc({ 'trustx.setSeatMarking': FIXTURES['trustx.markings'], 'trustx.setPolicy': { state: 'applied' } });
    const { user, navigate } = draw(at('rules', 'see'), { rpc });
    expect((await screen.findAllByText('sales.csv')).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('radiogroup', { name: 'HDFC statement' }).length).toBe(1);
    expect(screen.getAllByRole('radiogroup', { name: 'sales.csv' }).length).toBe(1);
    expect(await screen.findByText('marked financial from the start')).toBeTruthy();
    expect(screen.getByText('personal: field phone in sales')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Books · Meanings' }));
    expect(navigate).toHaveBeenCalledWith({ place: 'books', sub: 'meanings' });
    const cell = screen.getByRole('radiogroup', { name: 'Accountant sees personal' });
    await user.click(within(cell).getByRole('radio', { name: 'Yes' }));
    await waitFor(() => expect(rpc.of('trustx.setSeatMarking')).toEqual([{ method: 'trustx.setSeatMarking', payload: { seat: 'accountant', kind: 'personal', sees: true } }]));
    const source = screen.getByRole('radiogroup', { name: 'sales.csv' });
    await user.click(within(source).getByRole('radio', { name: 'No' }));
    await user.click(screen.getByRole('button', { name: 'Stop reading' }));
    await waitFor(() => expect(rpc.of('trustx.setPolicy')).toEqual([{ method: 'trustx.setPolicy', payload: { allowedSources: ['bank-hdfc'] } }]));
    expect(rpc.of('trust.update')).toHaveLength(0);
  });

  test('without the source list, the counts from the rules', async () => {
    const base = { ...FIXTURES }; delete base['sources.list'];
    draw(at('rules', 'see'), { rpc: fakeRpc({}, base) });
    expect(await screen.findByText(/The list of sources is not built yet\. From the rules:/)).toBeTruthy();
    expect(await screen.findByText(SEE.en.addNotBuilt)).toBeTruthy();
  });
});

describe('TR-03 Send and dual control', () => {
  test('levels as tables of the person\'s own data, the level in use, and one request per choice', async () => {
    const rpc = fakeRpc({ 'trustx.setSend': { state: 'applied' } });
    const { user, container } = draw(at('rules', 'send'), { rpc });
    expect((await screen.findAllByText('CUSTOMER_2')).length).toBe(1);
    expect(screen.getAllByText(SEND.en.example).length).toBe(2);
    expect(container.querySelector('[data-level="shape"]')?.getAttribute('aria-current')).toBe('true');
    expect(screen.getByText(SEND.en.voiceNote)).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: SEND.en.use })[0]!);
    await waitFor(() => expect(rpc.of('trustx.setSend')).toHaveLength(1));
    expect(rpc.of('trustx.setSend')[0]!.payload).toEqual({ level: 'nothing' });
  });

  test('a cofounder\'s change waits for the owner; no Confirm on one\'s own change', async () => {
    const mine = { id: 'ch-1', what: 'send', summary: 'Send: samples', by: 'co-1', at: AT, needs: 'owner' };
    let pending: unknown[] = [];
    const rpc = fakeRpc({
      'trustx.setSend': () => { pending = [mine]; return { state: 'waiting-for-second', change: mine }; },
      'trustx.pendingChanges': () => ({ items: pending }),
    });
    const { user } = draw(at('rules', 'send'), { rpc, role: 'cofounder', memberId: 'co-1' });
    const samples = await screen.findByRole('region', { name: SEND.en['level.samples'] });
    await user.click(within(samples).getByRole('button', { name: SEND.en.use }));
    expect(await screen.findByText(COMMON.en.waitOwner)).toBeTruthy();
    expect(await screen.findByText('Send: samples')).toBeTruthy();
    expect(screen.getByText(COMMON.en.yourChange)).toBeTruthy();
    expect(screen.queryByRole('button', { name: COMMON.en.confirm })).toBeNull();
    expect(rpc.of('trustx.setSend')).toEqual([{ method: 'trustx.setSend', payload: { level: 'samples' } }]);
  });

  test('the other admin confirms', async () => {
    const theirs = { id: 'ch-2', what: 'send', summary: 'Send: samples', by: 'co-1', at: AT, needs: 'owner' };
    const rpc = fakeRpc({ 'trustx.pendingChanges': { items: [theirs] }, 'trustx.confirmChange': { state: 'applied' } });
    const { user } = draw(at('rules', 'send'), { rpc, role: 'owner', memberId: 'owner-1' });
    await user.click(await screen.findByRole('button', { name: COMMON.en.confirm }));
    await waitFor(() => expect(rpc.of('trustx.confirmChange')).toEqual([{ method: 'trustx.confirmChange', payload: { id: 'ch-2' } }]));
  });

  test('a confirmed invite shows its one-time code to the person who confirmed it', async () => {
    const theirs = { id: 'ch-9', what: 'seats', summary: 'Invite Synthetic accountant', by: 'owner-1', at: AT, needs: 'cofounder' };
    let confirmed = false;
    const rpc = fakeRpc({ 'trustx.pendingChanges': () => ({ items: confirmed ? [] : [theirs] }),
      'trustx.confirmChange': () => { confirmed = true; return { state: 'applied', invite: { id: 'invite-9', token: 'synthetic-one-time-code', expiresAt: AT }, guide: { html: '<p>guide</p>' } }; } });
    const { user } = draw(at('people'), { rpc, role: 'cofounder', memberId: 'co-1' });
    await user.click(await screen.findByRole('button', { name: COMMON.en.confirm }));
    expect(await screen.findByText('synthetic-one-time-code')).toBeTruthy();
    expect(screen.getByText('<p>guide</p>')).toBeTruthy();
    expect(rpc.of('trustx.confirmChange')).toHaveLength(1);
  });

  test('waiting for the cofounder', async () => {
    const change = { id: 'ch-3', what: 'send', summary: 'Local only', by: 'owner-1', at: AT, needs: 'cofounder' };
    const rpc = fakeRpc({ 'trustx.setSend': { state: 'waiting-for-second', change } });
    const { user } = draw(at('rules', 'send'), { rpc });
    const local = await screen.findByRole('radiogroup', { name: SEND.en.localTitle });
    await user.click(within(local).getByRole('radio', { name: 'Yes' }));
    expect(await screen.findByText(COMMON.en.waitCofounder)).toBeTruthy();
    expect(rpc.of('trustx.setSend')[0]!.payload).toEqual({ localOnly: true });
  });
});

describe('TR-04 Keep', () => {
  test('until you delete it, the disk list, and a change', async () => {
    const rpc = fakeRpc({ 'trustx.setKeep': FIXTURES['trustx.keep'] });
    const { user } = draw(at('rules', 'keep'), { rpc });
    expect(await screen.findByText('until you delete it')).toBeTruthy();
    expect(screen.getByText('vault/state.enc')).toBeTruthy();
    const field = screen.getByLabelText('Days to keep Model answers');
    await user.clear(field); await user.type(field, '30');
    await user.click(screen.getAllByRole('button', { name: COMMON.en.save })[1]!);
    await waitFor(() => expect(rpc.of('trustx.setKeep')).toEqual([{ method: 'trustx.setKeep', payload: { kind: 'Model answers', days: 30 } }]));
  });
});

describe('TR-06 People and TR-07 the pen', () => {
  test('squares, seats, ended and removed seats, and this computer\'s role', async () => {
    const { container } = draw(at('people'));
    expect(await screen.findByText('Kiran')).toBeTruthy();
    expect(screen.getByText('This seat ended on 1 Oct 2026.')).toBeTruthy();
    expect(screen.getByText('Removed on 2 Oct 2026. What was already copied or exported stays with that person.')).toBeTruthy();
    expect(container.querySelector('[data-member="owner-1"] [class*="you"]')).toBeTruthy();
    expect(container.querySelector('[data-member="acc-1"] [class*="off"]')).toBeTruthy();
    expect(await screen.findByText(PEOPLE.en.reader)).toBeTruthy();
    expect(screen.getByText(PEOPLE.en.oneWriter)).toBeTruthy();
  });

  test('the pen is not built yet when sync.status does not answer', async () => {
    const base = { ...FIXTURES }; delete base['sync.status'];
    draw(at('people'), { rpc: fakeRpc({}, base) });
    expect(await screen.findByText('Not built yet.')).toBeTruthy();
  });

  test('remove asks once more and sends the member id once', async () => {
    const rpc = fakeRpc({ 'trustx.removeSeat': { state: 'applied' } });
    const { user } = draw(at('people'), { rpc });
    await user.click(await screen.findByRole('button', { name: PEOPLE.en.remove }));
    expect(rpc.of('trustx.removeSeat')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Remove Kiran' }));
    await waitFor(() => expect(rpc.of('trustx.removeSeat')).toEqual([{ method: 'trustx.removeSeat', payload: { memberId: 'acc-1' } }]));
  });

  test('invite shows the code once and the guide as text', async () => {
    const rpc = fakeRpc({ 'trustx.invite': { state: 'applied', invite: { id: 'inv-1', token: 'K7Q2-PL9X', expiresAt: '2026-10-21T00:00:00Z' }, guide: { html: '<h3>Guide for Kiran</h3><script>alert(1)</script>' } } });
    const { user, container } = draw(at('people', 'invite'), { rpc });
    await user.type(await screen.findByLabelText(PEOPLE.en.nameField), 'Kiran');
    await user.click(screen.getByRole('button', { name: PEOPLE.en.sendInvite }));
    expect(await screen.findByText('K7Q2-PL9X')).toBeTruthy();
    expect(screen.getByText(/This code is shown once\./)).toBeTruthy();
    const guide = container.querySelector('[data-guide]')!;
    expect(guide.tagName).toBe('PRE');
    expect(guide.textContent).toBe('<h3>Guide for Kiran</h3><script>alert(1)</script>');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('h3')).toBeNull();
    expect(rpc.of('trustx.invite')).toEqual([{ method: 'trustx.invite', payload: { seat: 'accountant', name: 'Kiran' } }]);
  });

  test('a CA seat needs an end date', async () => {
    const rpc = fakeRpc({ 'trustx.invite': { state: 'waiting-for-second', change: { id: 'c', what: 'seats', summary: 'Invite CA', by: 'owner-1', at: AT, needs: 'cofounder' } } });
    const { user } = draw(at('people', 'invite'), { rpc });
    await user.click(await screen.findByRole('radio', { name: 'CA' }));
    await user.type(screen.getByLabelText(PEOPLE.en.nameField), 'R. Mehta');
    await user.click(screen.getByRole('button', { name: PEOPLE.en.sendInvite }));
    expect(screen.getByText(PEOPLE.en.needEnd)).toBeTruthy();
    expect(rpc.of('trustx.invite')).toHaveLength(0);
    await user.type(screen.getByLabelText(PEOPLE.en.endsField), '2026-12-31');
    await user.click(screen.getByRole('button', { name: PEOPLE.en.sendInvite }));
    expect(await screen.findByText(COMMON.en.waitCofounder)).toBeTruthy();
    expect(rpc.of('trustx.invite')).toEqual([{ method: 'trustx.invite', payload: { seat: 'ca', name: 'R. Mehta', endsOn: '2026-12-31' } }]);
  });
});

describe('TR-08 Models', () => {
  test('routes in their order, terms, costs labelled cost, and the cap by string', async () => {
    const rpc = fakeRpc({ 'trustx.setModelCap': FIXTURES['trustx.models'] });
    const { user, container } = draw(at('models'), { rpc });
    const order = await waitFor(() => { const el = container.querySelector('[data-route-order]'); expect(el).toBeTruthy(); return el!; });
    expect([...order.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Cloud A', 'On this computer']);
    expect(screen.getByText('Terms not recorded for this route.')).toBeTruthy();
    expect(screen.getByText('Read on 1 Sep 2026')).toBeTruthy();
    expect(screen.getAllByText('cost').length).toBeGreaterThanOrEqual(3);
    const field = screen.getByLabelText('Monthly limit, in rupees');
    await user.clear(field); await user.type(field, '1,234.50');
    await user.click(screen.getByRole('button', { name: 'Set the limit' }));
    await waitFor(() => expect(rpc.of('trustx.setModelCap')).toEqual([{ method: 'trustx.setModelCap', payload: { monthlyCapMinor: '123450' } }]));
    await user.clear(field);
    await user.click(screen.getByRole('button', { name: 'Set the limit' }));
    await waitFor(() => expect(rpc.of('trustx.setModelCap')[1]!.payload).toEqual({ monthlyCapMinor: null }));
  });
});

describe('TR-09 Network', () => {
  test('waiting content as text, the canary alert, a filter and planting', async () => {
    const rpc = fakeRpc({ 'trustx.plantCanary': { planted: true, at: AT } });
    const { user, navigate } = draw(at('network'), { rpc });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Call call-77 carried it/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /plugin\.example/ }));
    expect(navigate).toHaveBeenCalledWith({ place: 'trust', sub: 'network', sheet: 'n2' });
    await user.click(screen.getByRole('radio', { name: 'plugin' }));
    await waitFor(() => expect(rpc.of('trustx.network').at(-1)!.payload).toEqual({ kind: 'plugin' }));
    await user.click(screen.getByRole('button', { name: NETWORK.en.plant }));
    await waitFor(() => expect(rpc.of('trustx.plantCanary')).toEqual([{ method: 'trustx.plantCanary', payload: {} }]));
  });

  test('the waiting sheet shows the exact content as text', async () => {
    const { container } = draw(at('network', 'n2'));
    const pre = await waitFor(() => { const el = container.querySelector('[data-waiting-content]'); expect(el).toBeTruthy(); return el!; });
    expect(pre.textContent).toBe('<script>alert(1)</script> total 1200');
    expect(container.querySelector('script')).toBeNull();
  });
});

describe('TR-10 Record', () => {
  test('entries, the check code, the limit sentence and Verify', async () => {
    const { user } = draw(at('record'));
    expect(await screen.findByText('Changed Send to shape only')).toBeTruthy();
    expect(screen.getByText('Check code AB12-CD34')).toBeTruthy();
    expect(screen.getByText(RECORD.en.limit)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('The record breaks at entry 7.')).toBeTruthy();
  });

  test('verified, and filters by person and day', async () => {
    const rpc = fakeRpc({ 'trustx.verifyRecord': { verified: true, brokenAt: null, head: 'AB12-CD34' } });
    const { user } = draw(at('record'), { rpc, language: 'hi' });
    await user.click(await screen.findByRole('button', { name: RECORD.hi.verify }));
    expect(await screen.findByText(RECORD.hi.verified)).toBeTruthy();
    await user.click(await screen.findByRole('radio', { name: 'Kiran' }));
    await waitFor(() => expect(rpc.of('trustx.record').at(-1)!.payload).toEqual({ memberId: 'acc-1' }));
    await user.type(screen.getByLabelText(RECORD.hi.dayField), '2026-10-14');
    await user.click(screen.getByRole('button', { name: RECORD.hi.showDay }));
    await waitFor(() => expect(rpc.of('trustx.record').at(-1)!.payload).toEqual({ memberId: 'acc-1', day: '2026-10-14' }));
  });
});

describe('TR-11, TR-14 and TR-15 Sharing (over learning-ext)', () => {
  test('intake closed, the boxes with their state, the running line, hosted promises and the notice in both languages', async () => {
    const { container } = draw(at('sharing'));
    expect(await screen.findByText(SHARING.en.notOpen)).toBeTruthy();
    expect(screen.getByText(SHARING.en.on)).toBeTruthy();
    expect(screen.getByText(SHARING.en['box.setup-shapes'])).toBeTruthy();
    const closed = container.querySelector('[data-box="question-shapes"]') as HTMLElement;
    expect(within(closed).getByText(SHARING.en.boxClosed)).toBeTruthy();
    expect(within(closed).queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByText(SHARING.en['box.account-words'])).toBeNull();
    expect(await screen.findByText('412 events shared, 0 names, 0 amounts.')).toBeTruthy();
    expect(await screen.findByText(/Hosted backup and sync are blind/)).toBeTruthy();
    expect(await screen.findByText('English privacy notice.')).toBeTruthy();
    expect(screen.getByText('हिंदी निजता सूचना।')).toBeTruthy();
    expect([...container.querySelectorAll('[data-notice]')].map((n) => n.getAttribute('data-notice'))).toEqual(['en', 'hi']);
    cleanup();
    const hi = draw(at('sharing'), { language: 'hi' });
    expect(await screen.findByText('हिंदी निजता सूचना।')).toBeTruthy();
    expect(screen.getByText('English privacy notice.')).toBeTruthy();
    expect([...hi.container.querySelectorAll('[data-notice]')].map((n) => n.getAttribute('data-notice'))).toEqual(['hi', 'en']);
    expect(await screen.findByText('412 घटनाएँ साझा, 0 नाम, 0 रकम।')).toBeTruthy();
    expect(screen.getByText(SHARING.hi.notOpen)).toBeTruthy();
  });

  test('the exact file is shown as text; a blocked batch says so and offers no Agree', async () => {
    const rpc = fakeRpc({ 'learningx.preview': { ...SHARE_PREVIEW, blocked: [{ line: 2, code: 'GSTIN' }] } });
    const { user, container } = draw(at('sharing'), { rpc });
    await user.click(await screen.findByRole('button', { name: SHARING.en.showFile }));
    expect(await screen.findByText(SHARING.en.blocked)).toBeTruthy();
    expect(screen.getByText('Line 2 looks like a GSTIN.')).toBeTruthy();
    expect(container.querySelector('[data-share-bytes]')!.textContent).toBe(SHARE_PREVIEW.bytes);
    expect(screen.queryByRole('button', { name: SHARING.en.agree })).toBeNull();
    expect(rpc.of('learningx.preview')).toEqual([{ method: 'learningx.preview', payload: { boxes: ['setup-shapes', 'corrections'] } }]);
  });

  test('choose the boxes, see the file, agree to its digest and share it once', async () => {
    const rpc = fakeRpc({
      'learningx.intakeStatus': { ...(FIXTURES['learningx.intakeStatus'] as object), open: true, mode: 'test-inbox', label: 'Demo test: sends to a test inbox only.' },
      'learningx.preview': SHARE_PREVIEW,
      'learningx.consent': { id: 'shareconsent_1', at: AT, previewId: 'sharepreview_1', digest: 'dg-file', publicName: null, memberId: 'owner-1', role: 'owner', epoch: 1, integrity: 'x' },
      'learningx.submit': { ...SHARE_BATCH, id: 'sharebatch_2' },
    });
    const { user } = draw(at('sharing'), { rpc });
    expect(await screen.findByText(SHARING.en.testInbox)).toBeTruthy();
    const corrections = screen.getByRole('radiogroup', { name: 'Share: Your corrections to mappings' });
    await user.click(within(corrections).getByRole('radio', { name: 'No' }));
    await user.click(screen.getByRole('button', { name: SHARING.en.showFile }));
    expect(await screen.findByText('3 bytes, 2 decisions, 0 names, 0 amounts.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: SHARING.en.agree }));
    expect(await screen.findByText('This batch is sent.')).toBeTruthy();
    expect(rpc.of('learningx.preview')).toEqual([{ method: 'learningx.preview', payload: { boxes: ['setup-shapes'] } }]);
    expect(rpc.of('learningx.consent')).toEqual([{ method: 'learningx.consent', payload: { previewId: 'sharepreview_1', digest: 'dg-file' } }]);
    expect(rpc.of('learningx.submit')).toEqual([{ method: 'learningx.submit', payload: { consentId: 'shareconsent_1' } }]);
  });

  test('no box chosen is never sent, and a refusal reads its sentence', async () => {
    const rpc = fakeRpc({ 'learningx.preview': refusal('NOTHING_TO_SHARE') });
    const { user } = draw(at('sharing'), { rpc });
    for (const name of ['Share: How your files are set up', 'Share: Your corrections to mappings']) {
      await user.click(within(await screen.findByRole('radiogroup', { name })).getByRole('radio', { name: 'No' }));
    }
    await user.click(screen.getByRole('button', { name: SHARING.en.showFile }));
    expect(screen.getByText(SHARING.en.noBox)).toBeTruthy();
    expect(rpc.of('learningx.preview')).toHaveLength(0);
    await user.click(within(screen.getByRole('radiogroup', { name: 'Share: Your corrections to mappings' })).getByRole('radio', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: SHARING.en.showFile }));
    expect(await screen.findByText(COMMON.en.nothingToShare)).toBeTruthy();
  });

  test('what I shared: each batch with Open and Delete, credits under a public name, and the batch sheet', async () => {
    const rpc = fakeRpc({ 'learningx.deleteBatch': { ...SHARE_BATCH, status: 'deleted', bytes: '' }, 'learningx.creditName': { publicName: 'Asha Rao' } });
    const { user, navigate } = draw(at('sharing'), { rpc });
    const row = await waitFor(() => { const el = document.querySelector('[data-batch="sharebatch_1"]'); expect(el).toBeTruthy(); return el as HTMLElement; });
    expect(within(row).getByText('sent')).toBeTruthy();
    expect(within(row).getByText(SHARING.en.testInboxTag)).toBeTruthy();
    await user.click(within(row).getByRole('button', { name: SHARING.en.open }));
    expect(navigate).toHaveBeenCalledWith({ place: 'trust', sub: 'sharing', sheet: 'sharebatch_1' });
    await user.click(within(row).getByRole('button', { name: SHARING.en.deleteBatch }));
    expect(rpc.of('learningx.deleteBatch')).toHaveLength(0);
    await user.click(within(row).getAllByRole('button', { name: SHARING.en.deleteBatch }).at(-1)!);
    await waitFor(() => expect(rpc.of('learningx.deleteBatch')).toEqual([{ method: 'learningx.deleteBatch', payload: { batchId: 'sharebatch_1' } }]));
    expect(screen.getByText(SHARING.en.creditsNone)).toBeTruthy();
    await user.type(screen.getByLabelText(SHARING.en.publicName), 'Asha 7');
    await user.click(within(screen.getByRole('heading', { name: SHARING.en.creditsTitle }).closest('section') as HTMLElement).getByRole('button', { name: COMMON.en.save }));
    expect(screen.getByText(SHARING.en.badName)).toBeTruthy();
    expect(rpc.of('learningx.creditName')).toHaveLength(0);
    await user.clear(screen.getByLabelText(SHARING.en.publicName));
    await user.type(screen.getByLabelText(SHARING.en.publicName), 'Asha Rao');
    await user.click(within(screen.getByRole('heading', { name: SHARING.en.creditsTitle }).closest('section') as HTMLElement).getByRole('button', { name: COMMON.en.save }));
    await waitFor(() => expect(rpc.of('learningx.creditName')).toEqual([{ method: 'learningx.creditName', payload: { publicName: 'Asha Rao' } }]));
    cleanup();
    const sheet = draw(at('sharing', 'sharebatch_1'));
    const pre = await waitFor(() => { const el = sheet.container.querySelector('[data-batch-bytes]'); expect(el).toBeTruthy(); return el!; });
    expect(pre.textContent).toBe(SHARE_BATCH.bytes);
    expect(sheet.rpc.of('learningx.batch')).toEqual([{ method: 'learningx.batch', payload: { batchId: 'sharebatch_1' } }]);
  });

  test('the learning log shows kind and choice in words; a seat that is not an admin sees no batches', async () => {
    draw(at('sharing'));
    expect(await screen.findByText('Reading a file: accepted')).toBeTruthy();
    expect(screen.getByText('Showing 1 of 1 decisions.')).toBeTruthy();
    cleanup();
    const staff = draw(at('sharing'), { role: 'accountant' });
    expect(await screen.findByText(SHARING.en.sharedAdmin)).toBeTruthy();
    expect(staff.rpc.of('learningx.batches')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: SHARING.en.showFile })).toBeNull();
  });

  test('the local cleaner sends the sample as data once and shows each hit by line and column', async () => {
    const rpc = fakeRpc({ 'learningx.cleanSample': SAMPLE });
    const { user, container } = draw(at('sharing'), { rpc });
    await user.click(await screen.findByRole('button', { name: SHARING.en.clean }));
    expect(screen.getByText(SHARING.en.emptySample)).toBeTruthy();
    expect(rpc.of('learningx.cleanSample')).toHaveLength(0);
    await user.type(screen.getByLabelText(SHARING.en.sample), 'Name,Notes{enter}Asha,call 98765 43210');
    await user.click(screen.getByRole('button', { name: SHARING.en.clean }));
    expect(await screen.findByText('Line 2, column Notes: a phone number')).toBeTruthy();
    expect(screen.getByText(SHARING.en.sampleBlocked)).toBeTruthy();
    expect(container.querySelector('[data-original]')!.textContent).toBe('Name,Notes\nAsha,call 98765 43210');
    expect(container.querySelector('[data-cleaned]')!.textContent).toBe(SAMPLE.cleaned);
    expect(rpc.of('learningx.cleanSample')).toEqual([{ method: 'learningx.cleanSample', payload: { content: 'Name,Notes\nAsha,call 98765 43210' } }]);
    expect(rpc.of('trustx.cleanSample')).toHaveLength(0);
  });

  test('withdraw (owner, asks twice), turning sharing on, and an agreement', async () => {
    const rpc = fakeRpc({ 'learningx.withdraw': { sharing: false, withdrawnConsents: 2, sentBatches: [] }, 'trustx.withdraw': FIXTURES['trustx.agreements'] });
    const { user } = draw(at('sharing'), { rpc });
    const sharing = (await screen.findByRole('heading', { level: 2, name: COMMON.en.sharing })).closest('section') as HTMLElement;
    await user.click(within(sharing).getByRole('button', { name: SHARING.en.withdraw }));
    await user.click(within(sharing).getByRole('button', { name: SHARING.en.withdrawConfirm }));
    expect(await screen.findByText('Sharing is withdrawn. 2 agreements not yet used were voided.')).toBeTruthy();
    expect(rpc.of('learningx.withdraw')).toEqual([{ method: 'learningx.withdraw', payload: {} }]);
    const agreements = screen.getByRole('heading', { name: SHARING.en.agreementsTitle }).closest('section') as HTMLElement;
    await user.click(within(agreements).getByRole('button', { name: SHARING.en.withdrawAgreement }));
    await user.click(within(agreements).getAllByRole('button', { name: SHARING.en.withdrawAgreement }).at(-1)!);
    await waitFor(() => expect(rpc.of('trustx.withdraw')).toEqual([{ method: 'trustx.withdraw', payload: { id: 'ag1' } }]));
    cleanup();
    const off = fakeRpc({ 'learningx.intakeStatus': { ...(FIXTURES['learningx.intakeStatus'] as object), sharingSwitch: false }, 'learning.sharing': refusal('SECOND_PERSON_REQUIRED') });
    const second = draw(at('sharing'), { rpc: off });
    await second.user.click(await screen.findByRole('button', { name: SHARING.en.turnOn }));
    expect(await screen.findByText(COMMON.en.secondPerson)).toBeTruthy();
    expect(off.of('learning.sharing')).toEqual([{ method: 'learning.sharing', payload: { enabled: true } }]);
    expect(screen.getByText('Sharing withdrawn on 14 Oct 2026.')).toBeTruthy();
    cleanup();
    draw(at('sharing'), { role: 'cofounder' });
    expect(await screen.findByText(COMMON.en.ownerOnly)).toBeTruthy();
    const group = screen.getByRole('heading', { level: 2, name: COMMON.en.sharing }).closest('section') as HTMLElement;
    expect(within(group).queryByRole('button', { name: SHARING.en.withdraw })).toBeNull();
  });

  test('TR-14: when the plan ended, it says so first; sharing not built', async () => {
    draw(at('sharing'), { rpc: fakeRpc({ 'trustx.hosted': { ...(FIXTURES['trustx.hosted'] as object), plan: 'ended' } }) });
    expect(await screen.findByText(SHARING.en.planEnded)).toBeTruthy();
    cleanup();
    draw(at('sharing'), { rpc: fakeRpc({ 'trustx.hosted': { ...(FIXTURES['trustx.hosted'] as object), plan: 'ended' } }), language: 'hi' });
    expect(await screen.findByText(SHARING.hi.planEnded)).toBeTruthy();
    cleanup();
    const base = { ...FIXTURES }; delete base['learningx.intakeStatus'];
    draw(at('sharing'), { rpc: fakeRpc({}, base) });
    expect(await screen.findByText('Not built yet.')).toBeTruthy();
  });
});

describe('TR-12 Vault and TR-13 deletion', () => {
  test('backup, test restore clears the passphrase, the limit sentence, experimental contact', async () => {
    const rpc = fakeRpc({ 'trustx.testRestore': { file: 'backup-1.chausar', at: AT, bytes: 1048576, testRestore: 'passed', testedAt: AT }, 'trustx.backupNow': { file: 'backup-2.chausar', at: AT, bytes: 1, testRestore: 'not-tested', testedAt: null } });
    const { user } = draw(at('vault'), { rpc });
    expect(await screen.findByText(/Its test restore passed\./)).toBeTruthy();
    expect(screen.getByText(/The passphrase limits this; it does not remove it\./)).toBeTruthy();
    expect(screen.getByText(VAULT.en.restoreNote)).toBeTruthy();
    // The recovery contact and the wake timer are both experimental.
    expect(screen.getAllByText('experimental').length).toBeGreaterThanOrEqual(1);
    const recovery = screen.getByRole('heading', { name: VAULT.en.recoveryTitle }).closest('section') as HTMLElement;
    expect(within(recovery).getByText('experimental')).toBeTruthy();
    const pass = screen.getByLabelText(VAULT.en.passphrase) as HTMLInputElement;
    expect(pass.type).toBe('password');
    await user.type(pass, 'synthetic pass');
    await user.click(screen.getAllByRole('button', { name: VAULT.en.runTest }).at(-1)!);
    expect(await screen.findByText(VAULT.en.testPassed)).toBeTruthy();
    expect(pass.value).toBe('');
    expect(rpc.of('trustx.testRestore')).toEqual([{ method: 'trustx.testRestore', payload: { file: 'backup-1.chausar', passphrase: 'synthetic pass' } }]);
    await user.click(screen.getByRole('button', { name: VAULT.en.backupNow }));
    await waitFor(() => expect(rpc.of('trustx.backupNow')).toEqual([{ method: 'trustx.backupNow', payload: {} }]));
  });

  test('deletion sends exactly { sourceId, confirmation } and shows the report', async () => {
    const rpc = fakeRpc({ 'trustx.deleteSource': REPORT, 'trustx.exportDeletion': { name: 'deletion-del-1.csv', path: '/x/deletion-del-1.csv', bytes: 120, sha256: 'aa' } });
    const { user } = draw(at('vault', 'delete'), { rpc });
    await user.click(await screen.findByRole('radio', { name: 'sales' }));
    const again = screen.getByLabelText(DELETION.en.again);
    await user.type(again, 'sale');
    expect(screen.getByText(DELETION.en.mismatch)).toBeTruthy();
    expect((screen.getByRole('button', { name: DELETION.en.delete }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(again, 's');
    await user.click(screen.getByRole('button', { name: DELETION.en.delete }));
    expect(await screen.findByText('not possible')).toBeTruthy();
    expect(screen.getByText('Kept for 30 days by the provider.')).toBeTruthy();
    expect(rpc.of('trustx.deleteSource')).toEqual([{ method: 'trustx.deleteSource', payload: { sourceId: 'sales', confirmation: 'sales' } }]);
    await user.click(screen.getByRole('button', { name: DELETION.en.export }));
    expect(await screen.findByText('Saved as deletion-del-1.csv.')).toBeTruthy();
    expect(rpc.of('trustx.exportDeletion')).toEqual([{ method: 'trustx.exportDeletion', payload: { id: 'del-1' } }]);
  });

  test('only the owner deletes', async () => {
    draw(at('vault', 'delete'), { role: 'cofounder' });
    expect(await screen.findByText(DELETION.en.ownerOnly)).toBeTruthy();
    expect(screen.queryByRole('button', { name: DELETION.en.delete })).toBeNull();
  });
});

describe('a viewer seat reads only', () => {
  const CHANGE_WORDS = [SEND.en.use, PEOPLE.en.invite, PEOPLE.en.remove, VAULT.en.backupNow, NETWORK.en.plant, 'Set the limit', SHARING.en.withdraw, COMMON.en.save, COMMON.en.confirm, DELETION.en.delete, 'Remove the mark'];
  const places: Address[] = [at('rules'), at('rules', 'see'), at('rules', 'send'), at('rules', 'keep'), at('rules', 'do'), at('people'), at('people', 'invite'),
    at('models'), at('network'), at('sharing'), at('vault'), at('vault', 'delete'), at('markings'), at('retention')];
  for (const address of places) {
    test(`${address.sub}${address.sheet ? `?sheet=${address.sheet}` : ''}`, async () => {
      const rpc = fakeRpc({ 'trustx.pendingChanges': { items: [{ id: 'c9', what: 'send', summary: 'Send: samples', by: 'co-1', at: AT, needs: 'owner' }] } });
      const { container } = draw(address, { rpc, viewer: true, role: 'owner' });
      await screen.findAllByRole('heading');
      await waitFor(() => expect(rpc.calls.length).toBeGreaterThan(0));
      await new Promise((r) => setTimeout(r, 20));
      for (const name of CHANGE_WORDS) expect(screen.queryByRole('button', { name })).toBeNull();
      const groups = [...container.querySelectorAll('[role="radiogroup"]')].map((g) => g.getAttribute('aria-labelledby') && container.querySelector(`#${CSS.escape(g.getAttribute('aria-labelledby')!)}`)?.textContent);
      for (const label of groups) expect([NETWORK.en.filterKind, NETWORK.en.filterPlugin, RECORD.en.person]).toContain(label);
      expect(container.querySelector('input:not([readonly])') === null || address.sub === 'record').toBe(true);
      expect(rpc.calls.every((c) => !/^trustx\.(set|invite|remove|confirm|plant|withdraw|backup|test|delete|export)|^trust\.update/.test(c.method))).toBe(true);
    });
  }
});

describe('Simple and Books views', () => {
  const pages: [Address, keyof typeof COMMON.en][] = [[at('rules'), 'rules'], [at('people'), 'people'], [at('models'), 'models'], [at('network'), 'network'],
    [at('record'), 'record'], [at('sharing'), 'sharing'], [at('vault'), 'vault']];
  for (const view of ['simple', 'books'] as const) {
    for (const [address, key] of pages) {
      test(`${address.sub} in ${view}`, async () => {
        draw(address, { view });
        expect(await screen.findByRole('heading', { level: 1, name: COMMON.en[key] })).toBeTruthy();
      });
    }
  }
  test('Books shows ids and the full record hash; Simple keeps a route to its terms date', async () => {
    draw(at('models'), { view: 'books' });
    expect(await screen.findByText('cloud-a · cloud')).toBeTruthy();
    cleanup();
    draw(at('record'), { view: 'books' });
    expect(await screen.findByText('abcdef0123456789')).toBeTruthy();
    cleanup();
    draw(at('models'), { view: 'simple' });
    expect(await screen.findByText('Read on 1 Sep 2026')).toBeTruthy();
    expect(screen.queryByText('United States')).toBeNull();
  });
});

describe('TR-02 See: adding a marking, and a widening that waits', () => {
  test('choose a source and a kind, Mark sends exactly the source marking once', async () => {
    const rpc = fakeRpc({ 'trustx.setMarking': FIXTURES['trustx.markings'] });
    const { user } = draw(at('rules', 'see'), { rpc });
    const form = await screen.findByRole('form', { name: SEE.en.addTitle });
    await user.click(within(form).getByRole('button', { name: SEE.en.mark }));
    expect(screen.getByText(SEE.en.pickBoth)).toBeTruthy();
    expect(rpc.of('trustx.setMarking')).toHaveLength(0);
    await user.click(within(within(form).getByRole('radiogroup', { name: SEE.en.addSource })).getByRole('radio', { name: 'HDFC statement' }));
    await user.click(within(within(form).getByRole('radiogroup', { name: SEE.en.addKind })).getByRole('radio', { name: 'confidential' }));
    await user.click(within(form).getByRole('button', { name: SEE.en.mark }));
    await waitFor(() => expect(rpc.of('trustx.setMarking')).toEqual([{ method: 'trustx.setMarking',
      payload: { kind: 'confidential', target: { type: 'source', sourceId: 'bank-hdfc' }, on: true } }]));
    expect(await screen.findByText(COMMON.en.applied)).toBeTruthy();
  });

  test('a seat seeing more may wait for the second person, shown with the pending changes', async () => {
    const change = { id: 'ch-see', what: 'markings', summary: 'Seat accountant: personal on', by: 'owner-1', at: AT, needs: 'cofounder' };
    let pending: unknown[] = [];
    const rpc = fakeRpc({
      'trustx.setSeatMarking': () => { pending = [change]; return { state: 'waiting-for-second', change }; },
      'trustx.pendingChanges': () => ({ items: pending }),
    });
    const { user } = draw(at('rules', 'see'), { rpc });
    const cell = await screen.findByRole('radiogroup', { name: 'Accountant sees personal' });
    await user.click(within(cell).getByRole('radio', { name: 'Yes' }));
    expect(await screen.findByText(COMMON.en.waitCofounder)).toBeTruthy();
    expect(await screen.findByText('Seat accountant: personal on')).toBeTruthy();
    expect(screen.getByText(COMMON.en.yourChange)).toBeTruthy();
    expect(rpc.of('trustx.setSeatMarking')).toHaveLength(1);
  });

  test('Hindi words for the form; a viewer has no form', async () => {
    draw(at('rules', 'see'), { language: 'hi' });
    expect(await screen.findByRole('form', { name: SEE.hi.addTitle })).toBeTruthy();
    cleanup();
    draw(at('rules', 'see'), { viewer: true });
    await screen.findByText('marked financial from the start');
    expect(screen.queryByRole('form', { name: SEE.en.addTitle })).toBeNull();
  });
});

describe('TR-03 Send: approving a route for financial data, and the voice row', () => {
  test('a route from Models is added to the list, sent once as the whole list; voice reads the speech provider', async () => {
    const rpc = fakeRpc({ 'trustx.setSend': { state: 'applied' } });
    const { user } = draw(at('rules', 'send'), { rpc });
    expect(await screen.findByText(SEND.en.voiceNone)).toBeTruthy();
    const form = await screen.findByRole('form', { name: SEND.en.addRoute });
    await user.click(within(form).getByRole('button', { name: SEND.en.addRouteButton }));
    expect(screen.getByText(SEND.en.pickRoute)).toBeTruthy();
    await user.click(within(form).getByRole('radio', { name: 'Cloud A' }));
    await user.click(within(form).getByRole('button', { name: SEND.en.addRouteButton }));
    await waitFor(() => expect(rpc.of('trustx.setSend')).toEqual([{ method: 'trustx.setSend', payload: { financialRoutes: ['local-llama', 'cloud-a'] } }]));
    cleanup();
    const models = structuredClone(FIXTURES['trustx.models']) as { voice: { provider: string | null } };
    models.voice.provider = 'Synthetic Speech';
    draw(at('rules', 'send'), { rpc: fakeRpc({ 'trustx.models': models, 'trustx.sendLevels': { ...(FIXTURES['trustx.sendLevels'] as object), financialRoutes: ['local', 'cloud-a'] } }) });
    expect(await screen.findByText('Speech provider: Synthetic Speech.')).toBeTruthy();
    expect(screen.getByText(SEND.en.allApproved)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Cloud A' })).toBeTruthy();
  });

  test('without Models, routes cannot be added here and the screen says so', async () => {
    const base = { ...FIXTURES }; delete base['trustx.models'];
    draw(at('rules', 'send'), { rpc: fakeRpc({}, base) });
    expect(await screen.findByText(SEND.en.routesNotBuilt)).toBeTruthy();
  });
});

describe('TR-04 Keep and TR-06 People: engine codes in words', () => {
  test('keep kinds by name in Hindi; Books keeps the code', async () => {
    const keep = { kinds: [{ kind: 'facts', days: 365, note: 'Facts: removed after 365 days.' }, { kind: 'brand-new', days: null, note: '' }], inventory: [] };
    draw(at('rules', 'keep'), { rpc: fakeRpc({ 'trustx.keep': keep }), language: 'hi' });
    expect(await screen.findByText(KEEP.hi['kind.facts'])).toBeTruthy();
    expect(screen.getByText('brand-new')).toBeTruthy();
    cleanup();
    draw(at('rules', 'keep'), { rpc: fakeRpc({ 'trustx.keep': keep }), view: 'books' });
    expect(await screen.findByText(KEEP.en['kind.facts'])).toBeTruthy();
    expect(screen.getByText('facts')).toBeTruthy();
  });

  test('seat limits and deletion places are worded by their engine codes, in Hindi too; an unknown code is shown as the engine wrote it', async () => {
    const seats = structuredClone(FIXTURES['trustx.seats']) as { seats: { limits: string[]; limitCodes: string[] }[] };
    // The screen reads the code, not the sentence: a changed English sentence still reads in the screen's own words.
    seats.seats[1]!.limits = ['Reads only (reworded by the engine).', 'Something new.'];
    seats.seats[1]!.limitCodes = ['reads-only', 'something-new'];
    draw(at('people'), { rpc: fakeRpc({ 'trustx.seats': seats }), language: 'hi' });
    expect(await screen.findByText(`${laneWords.hi['RTT.codes.limit.reads-only']} · Something new.`)).toBeTruthy();
    cleanup();
    draw(at('people'), { rpc: fakeRpc({ 'trustx.seats': seats }) });
    expect(await screen.findByText(`${laneWords.en['RTT.codes.limit.reads-only']} · Something new.`)).toBeTruthy();
    cleanup();
    draw(at('vault', 'delete'), { rpc: fakeRpc({ 'trustx.deletions': { items: [REPORT] } }), language: 'hi' });
    expect(await screen.findByText(laneWords.hi['RTT.codes.place.ai-provider']!)).toBeTruthy();
    expect(screen.getByText('Books')).toBeTruthy();
    cleanup();
    // A reply without the codes is refused as a shape the screen cannot read.
    const old = structuredClone(FIXTURES['trustx.seats']) as { seats: Record<string, unknown>[] };
    delete old.seats[0]!['limitCodes'];
    draw(at('people'), { rpc: fakeRpc({ 'trustx.seats': old }) });
    await waitFor(() => expect(screen.queryByText('Asha')).toBeNull());
    expect(validateDeletion({ ...REPORT, rows: [{ place: 'Kept', code: null, state: 'deleted', reason: 'r' }] }).rows[0]!.code).toBeNull();
    expect(() => validateDeletion({ ...REPORT, rows: [{ place: 'Kept', state: 'deleted', reason: 'r' }] })).toThrow();
    expect(() => validateDeletion({ ...REPORT, rows: [{ place: 'Kept', code: 'Not A Code', state: 'deleted', reason: 'r' }] })).toThrow();
  });
});

describe('TR-12 Vault: missing values, Restore, PIN and this computer', () => {
  test('a null idle time and version read as words; restore and PIN are plain words; the background service', async () => {
    const vault = { ...(FIXTURES['trustx.vault'] as object), lock: { idleMinutes: null, deviceCheck: false }, version: null };
    const rpc = fakeRpc({ 'trustx.vault': vault, 'service.status': SERVICE, 'service.install': { ...SERVICE, installed: true, running: true } });
    const { user } = draw(at('vault'), { rpc });
    expect(await screen.findByText(VAULT.en.versionUnknown)).toBeTruthy();
    expect(screen.getByText(VAULT.en.idleUnknown)).toBeTruthy();
    expect((screen.getByLabelText(VAULT.en.idle) as HTMLInputElement).value).toBe('');
    expect(screen.getByText(VAULT.en.restoreNote)).toBeTruthy();
    expect(screen.getByText(VAULT.en.pin)).toBeTruthy();
    expect(await screen.findByText(`${VAULT.en.service}: ${VAULT.en['service.off']}`)).toBeTruthy();
    // Wake for jobs is now its own group over jobs-ext (reports-tools-trust-vault-hosted.test.tsx).
    expect(screen.queryByText(VAULT.en.wake)).toBeNull();
    await user.click(screen.getByRole('button', { name: VAULT.en.turnOn }));
    expect(rpc.of('service.install')).toHaveLength(0);
    await user.click(screen.getAllByRole('button', { name: VAULT.en.turnOn }).at(-1)!);
    await waitFor(() => expect(rpc.of('service.install')).toEqual([{ method: 'service.install', payload: { confirmed: true } }]));
    cleanup();
    draw(at('vault'), { rpc: fakeRpc({ 'trustx.vault': vault }), viewer: true, language: 'hi' });
    expect(await screen.findByText(VAULT.hi.versionUnknown)).toBeTruthy();
    expect(screen.getByText(new RegExp(VAULT.hi.idleUnknown))).toBeTruthy();
    expect(screen.getByText(VAULT.hi.computerAdmin)).toBeTruthy();
  });

  test('this computer is not built yet without the service methods', async () => {
    draw(at('vault'));
    const group = (await screen.findByRole('heading', { name: VAULT.en.computerTitle })).closest('section') as HTMLElement;
    expect(await within(group).findByText('Not built yet.')).toBeTruthy();
  });
});

describe('TR-09 Network: release a waiting send', () => {
  const MODEL_WAIT = { id: 'mp-1', at: AT, kind: 'model', destination: 'Cloud A', why: 'Answer a question', bytes: 64, outcome: 'waiting', waitingContent: 'What was billed?' };
  const net = { ...(FIXTURES['trustx.network'] as object), items: [MODEL_WAIT, ...(FIXTURES['trustx.network'] as { items: unknown[] }).items] };

  test('Release asks once more and sends models.approve with the id once; no Discard, in words', async () => {
    const rpc = fakeRpc({ 'trustx.network': net, 'models.approve': { id: 'outbound_approval_1', kind: 'outbound-approval', previewId: 'mp-1', expiresAt: AT } });
    const { user } = draw(at('network', 'mp-1'), { rpc });
    expect(await screen.findByText(NETWORK.en.discard)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: NETWORK.en.release }));
    expect(screen.getByText('Release exactly this content to Cloud A?')).toBeTruthy();
    expect(rpc.of('models.approve')).toHaveLength(0);
    await user.click(screen.getAllByRole('button', { name: NETWORK.en.release }).at(-1)!);
    expect(await screen.findByText(NETWORK.en.released)).toBeTruthy();
    expect(rpc.of('models.approve')).toEqual([{ method: 'models.approve', payload: { id: 'mp-1' } }]);
  });

  test('a tainted context is refused with its sentence; a waiting plugin send points to Approvals; a viewer cannot release', async () => {
    const rpc = fakeRpc({ 'trustx.network': net, 'models.approve': refusal('TAINTED_APPROVAL') });
    const { user } = draw(at('network', 'mp-1'), { rpc, language: 'hi' });
    await user.click(await screen.findByRole('button', { name: NETWORK.hi.release }));
    await user.click(screen.getAllByRole('button', { name: NETWORK.hi.release }).at(-1)!);
    expect(await screen.findByText(COMMON.hi.taintedApproval)).toBeTruthy();
    cleanup();
    const other = draw(at('network', 'n2'));
    expect(await screen.findByText(NETWORK.en.approveElsewhere)).toBeTruthy();
    await other.user.click(screen.getByRole('button', { name: NETWORK.en.openApprovals }));
    expect(other.navigate).toHaveBeenCalledWith({ place: 'work', sub: 'approvals' });
    expect(screen.queryByRole('button', { name: NETWORK.en.release })).toBeNull();
    cleanup();
    draw(at('network', 'mp-1'), { rpc: fakeRpc({ 'trustx.network': net }), viewer: true });
    expect(await screen.findByText(NETWORK.en.releaseAdmin)).toBeTruthy();
    expect(screen.queryByRole('button', { name: NETWORK.en.release })).toBeNull();
  });
});

describe('the See, Send and Keep sheets and TR-13 in Simple and Books', () => {
  const sheets: [Address, string][] = [[at('rules', 'see'), COMMON.en.see], [at('rules', 'send'), COMMON.en.send], [at('rules', 'keep'), COMMON.en.keep], [at('vault', 'delete'), DELETION.en.title]];
  for (const view of ['simple', 'books'] as const) {
    for (const [address, title] of sheets) {
      test(`${address.sub}?sheet=${address.sheet} in ${view}`, async () => {
        draw(address, { view, rpc: fakeRpc({ 'trustx.deletions': { items: [REPORT] } }) });
        expect(await screen.findByRole('heading', { level: 2, name: title })).toBeTruthy();
        await waitFor(() => expect(screen.queryByText(/INVALID_REPLY/)).toBeNull());
      });
    }
  }
  test('Books adds source ids on See, the route id on Send and the kind code on Keep; Simple keeps the same facts', async () => {
    draw(at('rules', 'see'), { view: 'books' });
    expect(await screen.findByText('bank-hdfc')).toBeTruthy();
    cleanup();
    draw(at('rules', 'see'), { view: 'simple' });
    expect(await screen.findByText('marked financial from the start')).toBeTruthy();
    expect(await screen.findByRole('form', { name: SEE.en.addTitle })).toBeTruthy();
    cleanup();
    draw(at('rules', 'send'), { view: 'books' });
    expect((await screen.findAllByText('local-llama')).length).toBe(2);
    cleanup();
    draw(at('rules', 'send'), { view: 'simple' });
    expect(await screen.findByText(SEND.en.financialTitle)).toBeTruthy();
    expect(screen.getByText(SEND.en.voiceNote)).toBeTruthy();
    cleanup();
    draw(at('rules', 'keep'), { view: 'simple' });
    expect(await screen.findByText('vault/state.enc')).toBeTruthy();
    cleanup();
    draw(at('vault', 'delete'), { view: 'books', rpc: fakeRpc({ 'trustx.deletions': { items: [REPORT] } }) });
    expect(await screen.findByText('Kept for 30 days by the provider.')).toBeTruthy();
  });
});

describe('dual control: declining, withdrawing, cooling off and source access', () => {
  test('the needed person confirms or declines; decline sends decline: true once', async () => {
    const theirs = { id: 'ch-5', what: 'send', summary: 'Send: samples', by: 'co-1', at: AT, needs: 'owner' };
    const rpc = fakeRpc({ 'trustx.pendingChanges': { items: [theirs] }, 'trustx.confirmChange': { state: 'declined', change: theirs } });
    const { user } = draw(at('rules', 'send'), { rpc });
    expect(await screen.findByRole('button', { name: COMMON.en.confirm })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: COMMON.en.decline }));
    expect(await screen.findByText(COMMON.en.declined)).toBeTruthy();
    expect(rpc.of('trustx.confirmChange')).toEqual([{ method: 'trustx.confirmChange', payload: { id: 'ch-5', decline: true } }]);
  });

  test('the author withdraws their own change; no Confirm on it', async () => {
    const mine = { id: 'ch-6', what: 'send', summary: 'Send: samples', by: 'co-1', at: AT, needs: 'owner' };
    const rpc = fakeRpc({ 'trustx.pendingChanges': { items: [mine] }, 'trustx.confirmChange': { state: 'declined', change: mine } });
    const { user } = draw(at('rules', 'send'), { rpc, role: 'cofounder', memberId: 'co-1', language: 'hi' });
    await user.click(await screen.findByRole('button', { name: COMMON.hi.withdrawChange }));
    expect(await screen.findByText(COMMON.hi.withdrawnChange)).toBeTruthy();
    expect(screen.queryByRole('button', { name: COMMON.hi.confirm })).toBeNull();
    expect(rpc.of('trustx.confirmChange')).toEqual([{ method: 'trustx.confirmChange', payload: { id: 'ch-6', decline: true } }]);
  });

  test('removing the only cofounder: the owner confirming early reads the 72-hour sentence', async () => {
    const remove = { id: 'ch-7', what: 'seats', summary: 'Remove Co from the cofounder seat. The cofounder has 72 hours to answer.', by: 'owner-1', at: AT, needs: 'cofounder', coolsOffAt: '2099-01-01T00:00:00.000Z' };
    const rpc = fakeRpc({ 'trustx.pendingChanges': { items: [remove] }, 'trustx.confirmChange': refusal('COOLING_OFF') });
    const { user } = draw(at('people'), { rpc });
    await user.click(await screen.findByRole('button', { name: COMMON.en.confirmOwn }));
    expect(await screen.findByText(COMMON.en.coolingOff)).toBeTruthy();
    expect(rpc.of('trustx.confirmChange')).toEqual([{ method: 'trustx.confirmChange', payload: { id: 'ch-7' } }]);
  });

  test('turning a source back on may wait; a change from outside the app reads its sentence', async () => {
    const change = { id: 'ch-8', what: 'policy', summary: 'Change allow 2 named sources.', by: 'owner-1', at: AT, needs: 'cofounder' };
    let pending: unknown[] = [];
    const rpc = fakeRpc({ 'trust.get': { allowedSources: ['sales'] }, 'trustx.setPolicy': () => { pending = [change]; return { state: 'waiting-for-second', change }; }, 'trustx.pendingChanges': () => ({ items: pending }) });
    const { user } = draw(at('rules', 'see'), { rpc });
    const source = await screen.findByRole('radiogroup', { name: 'HDFC statement' });
    await user.click(within(source).getByRole('radio', { name: 'Yes' }));
    expect(await screen.findByText(COMMON.en.waitCofounder)).toBeTruthy();
    expect(await screen.findByText('Change allow 2 named sources.')).toBeTruthy();
    expect(rpc.of('trustx.setPolicy')).toEqual([{ method: 'trustx.setPolicy', payload: { allowedSources: ['sales', 'bank-hdfc'] } }]);
    cleanup();
    const refused = fakeRpc({ 'trust.get': { allowedSources: ['sales'] }, 'trustx.setPolicy': refusal('APP_CONSENT_REQUIRED') });
    const second = draw(at('rules', 'see'), { rpc: refused });
    await second.user.click(within(await screen.findByRole('radiogroup', { name: 'HDFC statement' })).getByRole('radio', { name: 'Yes' }));
    expect(await screen.findByText(COMMON.en.appOnly)).toBeTruthy();
  });
});
