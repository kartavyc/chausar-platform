// ca-enterprise host wiring: the hook alone with a fake rpc, and the real host (mountHost) with a
// synthetic transport, in the enterprise shell and with no lane methods (the desktop unchanged).
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { engine as frozenFirstRunEngine, nodeDigest } from '../../app/ui/tests/first-run/fixture';
import { fullCalculationReceiptFixture } from '../../app/ui/tests/fixtures';
import { mountHost } from '../../app/ui/src/host/bootstrap';
import { createHostController } from '../../app/ui/src/host/controller';
import type { HostRpcPort } from '../../app/ui/src/host/contracts';
import type { TodayData, TodayIntents } from '../../app/ui/src/screens/today/TodayData';
import { useCaEnterpriseShell } from '../../app/ui/src/screens/ca-enterprise/host-wiring';

const SHELL = { kind: 'enterprise', administers: true, allowed: null, views: ['guided', 'books'], home: { place: 'company' } };
const GROUP = { companies: [{ id: 'br-1', name: 'North Ltd' }, { id: 'br-2', name: 'South Ltd' }], chosen: 'all', combined: { eliminations: 'not-built' } };
const INSIDE = { inside: true, firmName: 'Mehta & Co', workspaceName: 'Shop A', seat: 'ca', endsOn: '2026-12-31', can: ['read', 'export'] };

function rpcOf(handlers: Record<string, unknown>) {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  return {
    calls,
    rpc: {
      async request(method: string, payload: Record<string, unknown>) {
        calls.push({ method, payload });
        const h = handlers[method];
        if (h === undefined) throw Object.assign(new Error('unknown'), { code: 'UNKNOWN_METHOD' });
        return typeof h === 'function' ? (h as (p: Record<string, unknown>) => unknown)(payload) : structuredClone(h);
      },
    },
  };
}

const TODAY = { data: { state: { kind: 'ready' }, date: '', review: { count: { exact: 0, display: '0' }, rows: [] } } as unknown as TodayData, intents: { onReview: () => {}, onReceipt: () => {} } as TodayIntents };

test('the hook gives the enterprise AppProps pieces: kind, grants, views, companies, banner and the lens', async () => {
  const fake = rpcOf({
    'caent.shell': { ...SHELL, allowed: ['today.today', 'company.health'] },
    'enterprise.lens.get': { lens: 'finance', lenses: ['whole-group', 'finance'] },
    'enterprise.lens.set': (p: Record<string, unknown>) => ({ lens: p.lens, lenses: ['whole-group', 'finance', 'sales'] }),
    'enterprise.companies': GROUP,
    'enterprise.company.set': (p: Record<string, unknown>) => ({ ...GROUP, chosen: p.id }),
    'castatus.inside': INSIDE,
  });
  const { result, rerender } = renderHook(({ k }) => useCaEnterpriseShell(fake.rpc, k, 'en'), { initialProps: { k: 'a' } });
  await waitFor(() => expect(result.current.menu.companies).toHaveLength(2));
  await waitFor(() => expect(result.current.lens).toBe('finance'));
  const lane = result.current;
  expect(lane.kind).toBe('enterprise');
  expect(lane.administers).toBe(true);
  expect([...lane.allowed!]).toEqual(['company.health', 'today.today']);
  expect(lane.home).toEqual({ place: 'company' });
  expect(lane.menu.views).toEqual(['guided', 'books']);
  expect(lane.menu.companyId).toBe('all');
  expect(lane.banners).toHaveLength(1);
  expect(lane.banners[0]).toMatchObject({ kind: 'read-only', textKey: 'ENX-ca03.banner' });
  const today = lane.withToday(TODAY);
  expect(today.data.enterprise?.lens).toBe('finance');
  expect(typeof today.intents.onLens).toBe('function');
  // The grant set is memoized by content: a re-render keeps the same object.
  const before = lane.allowed;
  rerender({ k: 'a' });
  expect(result.current.allowed).toBe(before);
  act(() => { today.intents.onLens!('sales'); });
  await waitFor(() => expect(result.current.lens).toBe('sales'));
  expect(fake.calls.find((c) => c.method === 'enterprise.lens.set')!.payload).toEqual({ lens: 'sales' });
  act(() => { result.current.menu.onSwitchCompany!('br-2'); });
  await waitFor(() => expect(result.current.menu.companyId).toBe('br-2'));
  // A new authorized context reads again.
  const count = fake.calls.filter((c) => c.method === 'caent.shell').length;
  rerender({ k: 'b' });
  await waitFor(() => expect(fake.calls.filter((c) => c.method === 'caent.shell').length).toBe(count + 1));
});

test('nothing is read until the host frame is ready', async () => {
  const fake = rpcOf({ 'caent.shell': SHELL, 'castatus.inside': INSIDE });
  const { result, rerender } = renderHook(({ ready }) => useCaEnterpriseShell(fake.rpc, 'k', 'en', ready), { initialProps: { ready: false } });
  await act(async () => { await Promise.resolve(); });
  expect(fake.calls).toEqual([]);
  expect(result.current.kind).toBe('desktop');
  rerender({ ready: true });
  await waitFor(() => expect(result.current.kind).toBe('enterprise'));
});

test('no lane method, or an off-contract reply, keeps the desktop defaults exactly', async () => {
  for (const handlers of [{}, { 'caent.shell': { ...SHELL, kind: 'browser' }, 'castatus.inside': { inside: 'maybe' } }]) {
    const fake = rpcOf(handlers);
    const { result } = renderHook(() => useCaEnterpriseShell(fake.rpc, 'k', 'en'));
    await waitFor(() => expect(fake.calls.map((c) => c.method).sort()).toEqual(['caent.shell', 'castatus.inside']));
    await act(async () => { await Promise.resolve(); });
    const lane = result.current;
    expect(lane.kind).toBe('desktop');
    expect(lane.administers).toBeUndefined();
    expect(lane.allowed).toBeUndefined();
    expect(lane.menu).toEqual({});
    expect(lane.banners).toEqual([]);
    expect(lane.onLens).toBeUndefined();
    expect(lane.withToday(TODAY)).toBe(TODAY);
  }
});

// ---- The real host ----------------------------------------------------------------------

const disposals: (() => void)[] = [];
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('No network'));
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
});
afterEach(async () => {
  await act(async () => { for (const dispose of disposals.splice(0)) dispose(); });
  document.body.replaceChildren(); window.location.hash = '';
  vi.unstubAllGlobals();
});

function transport(lane: Record<string, unknown>) {
  const context = { workspace: { id: 'workspace_fixture', name: 'Synthetic group', demo: true }, member: { id: 'member_fixture', name: 'Fixture owner', role: 'owner', epoch: 1, branches: ['*'] }, contextKey: 'b'.repeat(64) };
  const route = { id: 'route_fixture', kind: 'openai-compatible', model: 'synthetic-model', enabled: true, installationVerified: false, label: 'Synthetic route' };
  const calls: string[] = [];
  const receipts = ['billed', 'received', 'earned', 'margin'].map(operation => {
    const base = fullCalculationReceiptFixture();
    const common = { ...base, id: `receipt_${operation}`, operation, period: { from: '2026-10-01', to: '2026-10-31' }, rows: base.rows.map(row => ({ ...row, validFrom: '2026-10-01' })) };
    return operation === 'margin' ? common : { ...common, figures: [{ key: 'total', label: 'Synthetic total', minor: '100', display: 'INR1.00', unit: 'money', currency: 'INR' }], valueMinor: '100', totalMinor: '100', allowedNumbers: ['100'] };
  });
  const port: HostRpcPort = { async request(method, payload) {
    calls.push(method);
    if (Object.hasOwn(lane, method)) return structuredClone(lane[method]);
    switch (method) {
      case 'todayx.shell': return { workspace: { demo: true }, clock: { mode: 'real' }, banners: [], autoLockMinutes: 15 };
      case 'ui.context': return context;
      case 'ontology.get': {
        const frozen = await frozenFirstRunEngine(), current = frozen.compile(frozen.pack(0), 1, 'member_fixture', '2026-10-01T09:00:00.000Z');
        return { current, history: [current] };
      }
      case 'models.list': return [route];
      case 'dashboard.get': return { workspace: { ...context.workspace, currency: 'INR', createdAt: '2026-10-01T09:00:00.000Z' }, calculations: receipts, factCount: 3, sources: 2, decisions: [], waitingActions: [], jobs: [], policy: { send: 'nothing', autonomy: false, allowedSources: ['*'], retentionDays: 90, sharing: false }, dictionary: null, lastActivity: [] };
      case 'receipts.get': return receipts.find(receipt => receipt.id === (payload as { id: string }).id);
      default: throw Object.assign(Error(`No synthetic ${method}`), { code: 'UNKNOWN_METHOD' });
    }
  } };
  return { port, calls };
}

async function mounted(lane: Record<string, unknown>) {
  const fixture = transport(lane);
  const controller = createHostController(fixture.port, { now: () => Date.parse('2026-10-03T12:00:00.000Z'), timeZone: 'UTC',
    firstRun: { digest: nodeDigest },
    dashboard: { title: 'Today', date: '2026-10-03', request: { period: { from: '2026-10-01', to: '2026-10-31' } },
      selections: [{ operation: 'billed', figureKey: 'total' }, { operation: 'received', figureKey: 'total' }, { operation: 'margin', figureKey: 'contribution' }] } });
  const container = document.createElement('div'); document.body.append(container);
  await act(async () => { const host = mountHost(container, controller); disposals.push(host.dispose); });
  await waitFor(() => expect(controller.snapshot().today).not.toBeNull());
  return fixture;
}

test('mounted host in the enterprise shell: Company in the rail, the lens on Today, the CA-03 banner', async () => {
  const fixture = await mounted({
    'caent.shell': SHELL, 'enterprise.lens.get': { lens: 'whole-group', lenses: ['whole-group', 'finance', 'sales', 'operations'] },
    'enterprise.companies': GROUP, 'castatus.inside': INSIDE,
  });
  expect(await screen.findByText('Shop A, a client of Mehta & Co. Reading and exporting until 31 Dec 2026.')).toBeTruthy();
  await waitFor(() => expect(screen.getAllByText('Company').length).toBeGreaterThan(0));
  expect(await screen.findByRole('radio', { name: 'Whole group' })).toBeTruthy();
  expect(fixture.calls).toContain('enterprise.companies');
});

test('mounted host with no lane methods stays the desktop app: no Company, no lens, no banner', async () => {
  const fixture = await mounted({});
  await waitFor(() => expect(fixture.calls).toContain('castatus.inside'));
  await waitFor(() => expect(fixture.calls).toContain('caent.shell'));
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByText('Company')).toBeNull();
  expect(screen.queryByRole('radio', { name: 'Whole group' })).toBeNull();
  expect(fixture.calls).not.toContain('enterprise.lens.get');
});
