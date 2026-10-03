import { act } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mountHost } from '../../app/ui/src/host/bootstrap';
import { createHostController } from '../../app/ui/src/host/controller';
import type { HostRpcPort } from '../../app/ui/src/host/contracts';
import type { ConversationRequest } from '../../app/ui/src/bridge/conversation-contract';
import { fullCalculationReceiptFixture } from '../../app/ui/tests/fixtures';
import { approvalFixture, groundedFixture, planningPreviewFixture, readbackFixture, synthesisPreviewFixture } from '../../app/ui/tests/conversation-fixtures';

// Actual React host/bridge composition with in-memory synthetic replies. No browser,
// pixels, font loading, Engine, provider, HTTP, native vault or keychain qualification.
const disposals: (() => void)[] = [];
const key = (value: string, ctrlKey = false) => window.dispatchEvent(new KeyboardEvent('keydown', { key: value, ctrlKey, bubbles: true, cancelable: true }));
const ask = () => {
  const element = document.querySelector('[data-region="ask"] input');
  if (!(element instanceof HTMLInputElement)) throw Error('Synthetic host ask input missing');
  return element;
};
const sheet = () => {
  const element = document.querySelector('[data-region="sheet"]');
  if (!(element instanceof HTMLElement)) throw Error('Synthetic host sheet missing');
  return within(element);
};

function transport() {
  const context = { workspace: { id: 'workspace_fixture', name: 'Synthetic Help fixture', demo: true }, member: { id: 'member_fixture', name: 'Fixture owner', role: 'owner', epoch: 1, branches: ['*'] }, contextKey: 'a'.repeat(64) };
  const route = { id: 'route_fixture', kind: 'openai-compatible', model: 'synthetic-model', enabled: true, installationVerified: false, label: 'Synthetic route' };
  const calls: { method: string; payload: unknown }[] = [];
  let preview = planningPreviewFixture();
  let saved: ReturnType<typeof readbackFixture> | null = null;
  let hold = false, release: (() => void) | null = null;
  const receipts = ['billed', 'received', 'earned', 'margin'].map(operation => {
    const base = fullCalculationReceiptFixture();
    const common = { ...base, id: `receipt_${operation}`, operation, period: { from: '2026-10-01', to: '2026-10-31' }, rows: base.rows.map(row => ({ ...row, validFrom: '2026-10-01' })) };
    return operation === 'margin' ? common : { ...common, figures: [{ key: 'total', label: 'Synthetic total', minor: '100', display: 'INR1.00', unit: 'money', currency: 'INR' }], valueMinor: '100', totalMinor: '100', allowedNumbers: ['100'] };
  });
  const port: HostRpcPort = { async request(method, payload) {
    calls.push({ method, payload: structuredClone(payload) });
    switch (method) {
      case 'ui.context': return context;
      case 'models.list': return [route];
      case 'dashboard.get': return { workspace: { ...context.workspace, currency: 'INR', createdAt: '2026-10-01T09:00:00.000Z' }, calculations: receipts, factCount: 3, sources: 2, decisions: [], waitingActions: [], jobs: [], policy: { send: 'nothing', autonomy: false, allowedSources: ['*'], retentionDays: 90, sharing: false }, dictionary: null, lastActivity: [] };
      case 'receipts.get': return receipts.find(receipt => receipt.id === (payload as { id: string }).id);
      case 'models.preview': preview = planningPreviewFixture(payload as ConversationRequest); return preview;
      case 'models.approve':
        if (hold) { hold = false; await new Promise<void>(resolve => { release = resolve; }); }
        return approvalFixture(preview);
      case 'conversation.ask': {
        const tools = groundedFixture(preview.id); saved = readbackFixture(tools, preview.naturalQuestion); return tools;
      }
      case 'conversation.get': return saved;
      case 'conversation.synthesis.preview': return synthesisPreviewFixture();
      default: throw Error(`Unexpected synthetic Help method ${method}`);
    }
  } };
  return { port, calls, holdApproval: () => { hold = true; }, releaseApproval: () => { if (!release) throw Error('No held approval'); release(); release = null; } };
}

async function mounted() {
  const fixture = transport();
  const controller = createHostController(fixture.port, { now: () => Date.parse('2026-10-03T12:00:00.000Z'), timeZone: 'UTC' });
  const container = document.createElement('div'); document.body.append(container);
  await act(async () => {
    const host = mountHost(container, controller); disposals.push(host.dispose);
  });
  await waitFor(() => expect(controller.snapshot().routes).toHaveLength(1));
  act(() => { key('2', true); });
  const route = await screen.findByRole('combobox');
  await userEvent.setup().selectOptions(route, 'route_fixture');
  await waitFor(() => expect(controller.snapshot().selectedRouteId).toBe('route_fixture'));
  return { ...fixture, controller, user: userEvent.setup() };
}

async function review(fixture: Awaited<ReturnType<typeof mounted>>) {
  // Match the original checked synthesis fixture objective, while testing real UI submission.
  await fixture.user.type(ask(), '  What was billed?  ');
  await fixture.user.keyboard('{Enter}');
  await screen.findByRole('heading', { name: 'Send your question to the AI model' });
  return sheet().getByRole('button', { name: 'Send once', exact: true });
}
const outbound = (fixture: ReturnType<typeof transport>) => fixture.calls.filter(call => ['models.approve', 'conversation.ask', 'conversation.synthesis.run'].includes(call.method));
async function help() { act(() => { key('/', true); }); await screen.findByRole('heading', { name: 'Keyboard shortcuts' }); }
async function closeHelp() { act(() => { key('Escape'); }); await waitFor(() => expect(document.querySelector('[data-region="sheet"]')).toBeNull()); }

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('No network in synthetic Help DOM regressions'));
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
});
afterEach(async () => {
  await act(async () => { for (const dispose of disposals.splice(0)) dispose(); });
  document.body.replaceChildren(); window.location.hash = '';
  expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});

test('repeated Help closes once and restores its stable ask opener', async () => {
  const fixture = await mounted(); const opener = ask(); opener.focus();
  await help(); await help();
  expect(document.querySelectorAll('[data-region="sheet"]')).toHaveLength(1);
  await closeHelp(); expect(document.activeElement).toBe(opener); expect(outbound(fixture)).toHaveLength(0);
});

test('same-task Help cancels planning before the still-connected captured Send button clicks', async () => {
  const fixture = await mounted(); const send = await review(fixture);
  expect(outbound(fixture)).toHaveLength(0);
  act(() => {
    key('/', true);
    // Real old DOM event target in the same React batch; no private React callback access.
    expect(send.isConnected).toBe(true); send.click();
  });
  await screen.findByRole('heading', { name: 'Keyboard shortcuts' });
  expect(fixture.controller.conversation.snapshot().kind).toBe('idle'); expect(outbound(fixture)).toHaveLength(0);
  await closeHelp(); expect(document.activeElement).toBe(ask());
});

test('an already-issued approval released after Help cannot dispatch a question or synthesis', async () => {
  const fixture = await mounted(); const send = await review(fixture); fixture.holdApproval();
  await fixture.user.click(send);
  await waitFor(() => expect(fixture.calls.filter(call => call.method === 'models.approve')).toHaveLength(1));
  await help(); await act(async () => { fixture.releaseApproval(); });
  expect(outbound(fixture).map(call => call.method)).toEqual(['models.approve']);
  expect(fixture.controller.conversation.snapshot().kind).toBe('idle');
  await closeHelp(); expect(document.activeElement).toBe(ask());
});

test('Help from final-writing review restores the Frame ask fallback after the original button is removed', async () => {
  const fixture = await mounted(); await fixture.user.click(await review(fixture));
  const opener = await screen.findByRole('button', { name: 'Preview writing', exact: true });
  await fixture.user.click(opener);
  await screen.findByRole('heading', { name: 'Send the results to be written up' });
  const before = outbound(fixture).length;
  await help(); expect(opener.isConnected).toBe(false); await closeHelp();
  expect(document.activeElement).toBe(ask()); expect(outbound(fixture)).toHaveLength(before);
});

test('Help from a connected answer control returns to Frame ask when cancellation removes that control', async () => {
  const fixture = await mounted(); await fixture.user.click(await review(fixture));
  const opener = await screen.findByRole('button', { name: 'Preview writing', exact: true }); opener.focus();
  expect(opener.isConnected).toBe(true); const before = outbound(fixture).length;
  await help(); expect(opener.isConnected).toBe(false); await closeHelp();
  expect(document.activeElement).toBe(ask()); expect(outbound(fixture)).toHaveLength(before);
});
