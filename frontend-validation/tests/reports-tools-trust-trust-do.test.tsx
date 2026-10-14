// TR-05 Do and the Do row of TR-01, drawn over the jobs-ext autonomy methods (`jobsx.*`) with a
// fake `rpc` whose replies follow `platform/runtime/jobs-ext/autonomy-methods.ts` on that lane.
// All data is synthetic.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language, View } from '../../app/ui/src/app/presentation';
import type { PlaceRenderProps } from '../../app/ui/src/places/types';
import { trustPlaces } from '../../app/ui/src/screens/trust/index';
import { COMMON, DO, RULES } from '../../app/ui/src/screens/trust/words';

afterEach(cleanup);

const AUTONOMY = {
  master: false, preset: 'custom',
  kinds: [
    { kind: 'local.draft-note', title: 'Draft a note', impact: 'reversible', switchable: true, on: true, dailyCount: 20, usedToday: 3, agreement: { approved: 9, declined: 1 } },
    { kind: 'local.tag', title: 'Tag a record', impact: 'reversible', switchable: true, on: false, dailyCount: 5, usedToday: 0, agreement: { approved: 0, declined: 0 } },
    { kind: 'local.send-reminder', title: 'Send a reminder', impact: 'message', switchable: false, on: false, dailyCount: 20, usedToday: 0, agreement: { approved: 2, declined: 0 } },
  ],
  alwaysWaits: { intro: 'Anything that cannot be undone, and in particular:', items: ['money', 'messages to outsiders', 'deleting', 'prices', 'stock', 'listings', 'sharing', 'invites to outsiders', 'webhooks', 'tax filings (prepare only)'] },
  caps: { activeJobCap: 10, failureLimit: 3, backgroundMode: false, backgroundAsked: false, reminderPerCustomerPerDay: 1, reminderPerDay: 20, groupMax: 10, autoReviewMinutes: 0 },
};
const RULES_REPLY = {
  see: { allSources: true, allowed: 1, refused: 0 }, send: { level: 'nothing', localOnly: true }, keep: { days: null },
  leftToday: { date: '2026-10-14', items: [] }, canChange: true, ownerOnly: ['send', 'sharing', 'seats'],
};
const MODELS = { routes: [], spendThisMonthMinor: '0', monthlyCapMinor: '100000', voice: { provider: null, minutesThisMonth: null } };

type Reply = unknown | ((payload: Record<string, unknown>) => unknown);
const refusal = (code: string) => Object.assign(new Error(code), { code });

function fakeRpc(extra: Record<string, Reply> = {}) {
  const replies: Record<string, Reply> = {
    'jobsx.autonomy': AUTONOMY, 'trustx.rules': RULES_REPLY, 'trustx.models': MODELS, 'trustx.pendingChanges': { items: [] },
    'jobsx.setAutonomy': (p: Record<string, unknown>) => ({ kind: p['kind'], on: p['on'], dailyCount: p['dailyCount'], preset: 'custom' }),
    'jobsx.autonomyPreset': (p: Record<string, unknown>) => ({ preset: p['preset'], on: ['local.draft-note'] }),
    'jobsx.setCaps': (p: Record<string, unknown>) => ({ ...AUTONOMY.caps, ...p }),
    ...extra,
  };
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

function draw(address: Address, o: { rpc?: ReturnType<typeof fakeRpc>; language?: Language; view?: View; role?: string; viewer?: boolean } = {}) {
  const rpc = o.rpc ?? fakeRpc();
  const mod = trustPlaces.find((m) => m.handles(address))!;
  const navigate = vi.fn();
  const props: PlaceRenderProps = {
    address, language: o.language ?? 'en', view: o.view ?? 'guided', member: { id: 'owner-1', role: o.role ?? 'owner' },
    viewer: o.viewer ?? false, rpc, live: () => true, openReceipt: vi.fn(), navigate,
  };
  const view = render(<TextProvider language={props.language}>{mod.render(props)}</TextProvider>);
  return { ...view, rpc, navigate, user: userEvent.setup() };
}
const DO_SHEET: Address = { place: 'trust', sub: 'rules', sheet: 'do' };
const kindRow = (container: HTMLElement, kind: string) => container.querySelector(`[data-kind="${kind}"]`) as HTMLElement;

describe('TR-05 Do over jobs-ext', () => {
  test('presets, each kind with its switch, daily count and agreement, the always-waits list and its kinds with no switches, the limits', async () => {
    const { container, rpc } = draw(DO_SHEET);
    expect(await screen.findByText(DO.en.presetNote)).toBeTruthy();
    expect(screen.getByText(DO.en.masterOff)).toBeTruthy();
    expect(screen.getByText(DO.en.custom)).toBeTruthy();
    expect(screen.getByText(DO.en.amountNotBuilt)).toBeTruthy();
    expect(screen.getByText('Up to 20 a day; 3 used today.')).toBeTruthy();
    expect(screen.getByText('You approved it 9 times and declined it 1 times.')).toBeTruthy();
    expect(screen.getByText(DO.en.noHistory)).toBeTruthy();
    expect(kindRow(container, 'local.send-reminder')).toBeNull();
    const waits = container.querySelector('[data-always-waits]')!.closest('section') as HTMLElement;
    expect(within(waits).getByText(DO.en.waitsLead)).toBeTruthy();
    expect(within(waits).getByText(DO.en['wait.messages'])).toBeTruthy();
    expect(within(waits).getByText(DO.en['wait.tax'])).toBeTruthy();
    expect(within(waits).getByText('Send a reminder')).toBeTruthy();
    expect(within(waits).queryAllByRole('radiogroup')).toHaveLength(0);
    expect(within(waits).queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByLabelText(DO.en['cap.reminderPerDay'])).toBeTruthy();
    expect(await screen.findByText(/Monthly AI cap/)).toBeTruthy();
    expect(rpc.calls.some((c) => c.method.startsWith('trustx.autonomy') || c.method === 'trustx.setAutonomy')).toBe(false);
  });

  test('a kind switch sends exactly its kind, the switch and its daily count, once', async () => {
    const { container, user, rpc } = draw(DO_SHEET);
    await screen.findByText(DO.en.presetNote);
    await user.click(within(kindRow(container, 'local.tag')).getByRole('radio', { name: 'Yes' }));
    await waitFor(() => expect(rpc.of('jobsx.setAutonomy')).toEqual([{ method: 'jobsx.setAutonomy', payload: { kind: 'local.tag', on: true, dailyCount: 5 } }]));
    // Read once by the sheet and once by the Rules row under it, then both again after the change.
    await waitFor(() => expect(rpc.of('jobsx.autonomy').length).toBe(4));
  });

  test('a daily count is checked against 1 to 100 before it is sent', async () => {
    const { container, user, rpc } = draw(DO_SHEET);
    await screen.findByText(DO.en.presetNote);
    const row = kindRow(container, 'local.draft-note');
    const field = within(row).getByLabelText('Most in a day for Draft a note');
    await user.clear(field); await user.type(field, '101');
    await user.click(within(row).getByRole('button', { name: COMMON.en.save }));
    expect(within(row).getByText('Type a whole number from 1 to 100.')).toBeTruthy();
    expect(rpc.of('jobsx.setAutonomy')).toHaveLength(0);
    await user.clear(field); await user.type(field, '30');
    await user.click(within(row).getByRole('button', { name: COMMON.en.save }));
    await waitFor(() => expect(rpc.of('jobsx.setAutonomy')).toEqual([{ method: 'jobsx.setAutonomy', payload: { kind: 'local.draft-note', on: true, dailyCount: 30 } }]));
  });

  test('a preset sends exactly the preset to jobsx.autonomyPreset', async () => {
    const { user, rpc } = draw(DO_SHEET);
    await user.click(await screen.findByRole('radio', { name: DO.en['preset.routine'] }));
    await waitFor(() => expect(rpc.of('jobsx.autonomyPreset')).toEqual([{ method: 'jobsx.autonomyPreset', payload: { preset: 'routine' } }]));
  });

  test('the limits send only what changed, inside the ranges jobs-ext takes', async () => {
    const { user, rpc } = draw(DO_SHEET);
    await screen.findByText(DO.en.presetNote);
    const perDay = screen.getByLabelText(DO.en['cap.reminderPerDay']);
    const save = () => screen.getAllByRole('button', { name: COMMON.en.save }).at(-1)!;
    await user.clear(perDay); await user.type(perDay, '300');
    await user.click(save());
    expect(screen.getByText(`${DO.en['cap.reminderPerDay']}: type a whole number from 1 to 200.`)).toBeTruthy();
    expect(rpc.of('jobsx.setCaps')).toHaveLength(0);
    await user.clear(perDay); await user.type(perDay, '25');
    await user.click(save());
    await waitFor(() => expect(rpc.of('jobsx.setCaps')).toEqual([{ method: 'jobsx.setCaps', payload: { reminderPerDay: 25 } }]));
  });

  test('not built when jobsx.autonomy is unknown, and a refusal shows its code', async () => {
    draw(DO_SHEET, { rpc: fakeRpc({ 'jobsx.autonomy': refusal('UNKNOWN_METHOD') }) });
    expect((await screen.findAllByText('Not built yet.')).length).toBe(2); // the sheet, and the Do row under it
    cleanup();
    const { container, user } = draw(DO_SHEET, { rpc: fakeRpc({ 'jobsx.setAutonomy': refusal('ALWAYS_WAITS') }) });
    await screen.findByText(DO.en.presetNote);
    await user.click(within(kindRow(container, 'local.tag')).getByRole('radio', { name: 'Yes' }));
    expect(await screen.findByText('Code ALWAYS_WAITS')).toBeTruthy();
  });

  test('a seat that is not owner or cofounder, and a viewer, read only', async () => {
    for (const o of [{ role: 'accountant' }, { role: 'owner', viewer: true }]) {
      const { container } = draw(DO_SHEET, o);
      await screen.findByText(DO.en.presetNote);
      expect(container.querySelectorAll('[role="radiogroup"]')).toHaveLength(0);
      expect(screen.queryByRole('button', { name: COMMON.en.save })).toBeNull();
      expect(screen.getByText(`${DO.en['cap.reminderPerDay']}: 20`)).toBeTruthy();
      cleanup();
    }
  });

  test('Simple leaves out the per-kind forms and the agreement; Books adds ids, impact and the two further limits', async () => {
    draw(DO_SHEET, { view: 'simple' });
    await screen.findByText(DO.en.presetNote);
    expect(screen.queryByLabelText('Most in a day for Draft a note')).toBeNull();
    expect(screen.queryByText(DO.en.amountNotBuilt)).toBeNull();
    expect(screen.queryByText(DO.en.noHistory)).toBeNull();
    expect(screen.queryByText('Send a reminder')).toBeNull();
    cleanup();
    draw(DO_SHEET, { view: 'books' });
    await screen.findByText(DO.en.presetNote);
    expect(screen.getByText('local.draft-note · can be undone')).toBeTruthy();
    expect(screen.getByLabelText(DO.en['cap.failureLimit'])).toBeTruthy();
    expect(screen.getByLabelText(DO.en['cap.groupMax'])).toBeTruthy();
    cleanup();
    draw(DO_SHEET, { view: 'guided' });
    await screen.findByText(DO.en.presetNote);
    expect(screen.queryByLabelText(DO.en['cap.failureLimit'])).toBeNull();
  });

  test('Hindi', async () => {
    draw(DO_SHEET, { language: 'hi' });
    expect(await screen.findByText(DO.hi.presetNote)).toBeTruthy();
    expect(screen.getByText(DO.hi['wait.messages'])).toBeTruthy();
    expect(screen.getByText('दिन में 20 तक; आज 3 हुए।')).toBeTruthy();
  });
});

describe('TR-01 the Do row reads jobs-ext', () => {
  test('the preset in words, and "Not built yet." when jobs-ext is absent', async () => {
    const { user } = draw({ place: 'trust', sub: 'rules' });
    expect(await screen.findByText(RULES.en['preset.custom'])).toBeTruthy();
    cleanup();
    draw({ place: 'trust', sub: 'rules' }, { rpc: fakeRpc({ 'jobsx.autonomy': refusal('UNKNOWN_METHOD') }) });
    expect(await screen.findByText(RULES.en.doNotBuilt)).toBeTruthy();
    void user;
  });
  test('a preset chosen in the Do sheet re-reads the row', async () => {
    const { user, rpc } = draw(DO_SHEET);
    await user.click(await screen.findByRole('radio', { name: DO.en['preset.routine'] }));
    await waitFor(() => expect(rpc.of('jobsx.autonomy').length).toBeGreaterThanOrEqual(3));
  });
});
