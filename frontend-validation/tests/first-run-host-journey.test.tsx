import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mountHost } from '../../app/ui/src/host/bootstrap';
import type { MountedHost } from '../../app/ui/src/host/bootstrap';
import { createHostController } from '../../app/ui/src/host/controller';
import type { HostRpcPort } from '../../app/ui/src/host/contracts';
import { validateUiContext } from '../../app/ui/src/host/contracts';
import { FIRST_RUN_METHODS } from '../../app/ui/src/screens/first-run/contracts';
import type { FirstRunMethod, FirstRunRpcPayloads } from '../../app/ui/src/screens/first-run/contracts';
import { LOCAL } from '../../app/ui/src/screens/first-run/text';
import { deferred, nodeDigest, settle, syntheticEngine } from '../../app/ui/tests/first-run/fixture';

// Actual React host and first-run controller with the existing authored CAS/receipt model
// and actual dictionary compiler. No Engine/storage/HTTP/native/provider/browser proof.
const cleanups: Array<() => void> = [];
const flush = async () => { await act(async () => { await settle(); }); };
function row(id: string) {
  const element = document.querySelector(`[data-first-run-row][data-row-id="${id}"]`);
  if (!(element instanceof HTMLElement)) throw Error(`Missing reviewed row ${id}`);
  return element;
}
function rowButton(id: string) {
  const element = row(id).querySelector('[data-row-main]');
  if (!(element instanceof HTMLButtonElement)) throw Error(`Missing row control ${id}`);
  return element;
}
async function review(user: ReturnType<typeof userEvent.setup>) {
  await user.click(rowButton('ecommerce')); await flush();
  for (const id of ['billed', 'received', 'earned', 'refunds', 'costs', 'purchases', 'settings']) {
    if (rowButton(id).getAttribute('aria-expanded') !== 'true') await user.click(rowButton(id));
    await user.click(within(row(id)).getByRole('button', { name: 'Accept' })); await flush();
  }
}
async function hostFixture(create = false) {
  const dictionary = await syntheticEngine();
  let opened = !create;
  const calls: Array<{ method: string; payload: unknown }> = [];
  const port: HostRpcPort = { async request(method, payload) {
    calls.push({ method, payload: structuredClone(payload) });
    if (method === 'workspace.create') {
      expect(opened).toBe(false); opened = true;
      return { workspace: { id: 'workspace_fixture', name: 'SYNTHETIC mounted creation', demo: false }, recoveryKit: 'SYNTHETIC one-time mounted kit', recoveryCode: 'SYNTHETIC one-time mounted kit' };
    }
    if (method === 'ui.context') {
      if (!opened) throw Object.assign(Error('Synthetic locked workspace'), { code: 'VAULT_LOCKED' });
      const context = validateUiContext(await dictionary.port.request('ui.context', {}));
      return create ? { ...context, workspace: { ...context.workspace, name: 'SYNTHETIC mounted creation', demo: false } } : context;
    }
    if (FIRST_RUN_METHODS.includes(method as FirstRunMethod)) return dictionary.port.request(method as FirstRunMethod, payload as FirstRunRpcPayloads[FirstRunMethod]);
    if (method === 'models.list') return [];
    throw Error(`Unexpected mounted first-run method ${method}`);
  } };
  const controller = createHostController(port, { todayProducer: {}, firstRun: { digest: nodeDigest, createAttemptId: () => 'mounted-reviewed-attempt' } });
  const container = document.createElement('div'); document.body.append(container);
  let mounted: MountedHost | null = null;
  const mount = async () => { await act(async () => { mounted = mountHost(container, controller, { view: 'books' }); }); };
  const unmount = () => { if (mounted === null) throw Error('Missing mount'); mounted.unmount(); mounted = null; };
  cleanups.push(() => { mounted?.unmount(); controller.dispose(); container.remove(); });
  await mount();
  return { dictionary, controller, calls, mount, unmount, user: userEvent.setup() };
}
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('No network in mounted first-run fixtures'));
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
});
afterEach(async () => {
  await act(async () => { for (const cleanup of cleanups.splice(0)) cleanup(); });
  document.body.replaceChildren(); window.location.hash = '';
  expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});

test('mounted deferred creation clears request secrets, preserves kit acknowledgement and reaches reviewed meanings before any figures', async () => {
  const fixture = await hostFixture(true);
  await screen.findByRole('heading', { name: 'Create a workspace for reviewed meanings' });
  expect(fixture.calls.some(call => call.method === 'workspace.create')).toBe(false);
  await fixture.user.type(screen.getByLabelText('Business name'), 'SYNTHETIC mounted creation');
  await fixture.user.type(screen.getByLabelText('Workspace folder'), 'synthetic-mounted');
  const secret = screen.getByLabelText('Passphrase'), confirmation = screen.getByLabelText('Repeat passphrase');
  if (!(secret instanceof HTMLInputElement) || !(confirmation instanceof HTMLInputElement)) throw Error('Expected password fields');
  await fixture.user.type(secret, 'Synthetic mounted passphrase'); await fixture.user.type(confirmation, 'Synthetic mounted passphrase');
  await fixture.user.click(screen.getByRole('button', { name: 'Create workspace' }));
  await screen.findByRole('heading', { name: 'Save your recovery kit' });
  expect(secret.value).toBe(''); expect(confirmation.value).toBe('');
  expect(fixture.calls.find(call => call.method === 'workspace.create')?.payload).toEqual({ name: 'SYNTHETIC mounted creation', folder: 'synthetic-mounted', passphrase: 'Synthetic mounted passphrase', dictionaryMode: 'deferred', demo: false });
  expect(JSON.stringify(fixture.controller.snapshot())).not.toContain('Synthetic mounted passphrase');
  expect(screen.getByRole('button', { name: 'Review my business meanings' }).hasAttribute('disabled')).toBe(true);
  expect(fixture.controller.dispose()).toEqual({ ok: false, code: 'PUBLISH_UNRESOLVED' });
  await fixture.user.click(screen.getByRole('checkbox', { name: 'I have saved this recovery kit separately.' }));
  await fixture.user.click(screen.getByRole('button', { name: 'Review my business meanings' }));
  await screen.findByRole('heading', { name: 'Pick a starter pack' });
  expect(screen.getAllByRole('main')).toHaveLength(1); expect(document.documentElement.dataset.view).toBe('books');
  expect(document.querySelector('[data-first-run-recovery]')).toBeNull();
  expect(JSON.stringify(fixture.controller.snapshot())).not.toContain('SYNTHETIC one-time mounted kit');
  expect(fixture.calls.some(call => ['dashboard.get', 'today.read', 'receipts.get', 'models.list'].includes(call.method))).toBe(false);
  await review(fixture.user); await fixture.user.click(screen.getByRole('button', { name: 'Publish' }));
  await screen.findByRole('button', { name: 'Continue' });
  await fixture.user.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(window.location.hash).toBe('#/ask/new'));
  await waitFor(() => expect(fixture.controller.snapshot().dictionaryReviewRequired).toBe(false));
  expect(fixture.controller.timeZone).toBeNull(); expect(fixture.controller.snapshot().todayConfiguration).toBe('not-configured');
  expect(document.querySelector('[data-today-configuration]')?.textContent).toContain('not configured');
  expect(fixture.calls.filter(call => call.method === 'ontology.publish')).toHaveLength(1);
  expect(fixture.calls.some(call => ['dashboard.get', 'today.read', 'receipts.get'].includes(call.method))).toBe(false);
});

test('mounted publication survives actual unmount and remount of the same host after a lost acknowledgement without another dispatch', async () => {
  const fixture = await hostFixture(); await screen.findByRole('heading', { name: 'Pick a starter pack' });
  await review(fixture.user);
  const raw = deferred<unknown>();
  fixture.dictionary.onRequest((method, _payload, defaults) => { if (method === 'ontology.publish') { defaults(); return raw.promise; } return undefined; });
  await fixture.user.click(screen.getByRole('button', { name: 'Publish' }));
  await waitFor(() => expect(fixture.controller.firstRun.issuance()).toBe('issued'));
  act(() => { fixture.unmount(); });
  expect(document.querySelector('main')).toBeNull();
  expect(fixture.controller.dispose()).toEqual({ ok: false, code: 'IN_FLIGHT' });
  await fixture.mount();
  act(() => { raw.reject(Object.assign(Error('Synthetic lost acknowledgement'), { code: 'REQUEST_FAILED' })); });
  await waitFor(() => expect(fixture.controller.firstRun.issuance()).toBe('unresolved'));
  expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  expect(fixture.controller.firstRun.snapshot()).toMatchObject({ kind: 'unknown', attempt: null });
  fixture.dictionary.onRequest(null);
  const reconcile = LOCAL.en['FR-08.reconcile']; if (reconcile === undefined) throw Error('Missing checked reconciliation label');
  await fixture.user.click(screen.getByRole('button', { name: reconcile }));
  await screen.findByRole('button', { name: 'Continue' });
  expect(fixture.calls.filter(call => call.method === 'ontology.publish')).toHaveLength(1);
  expect(fixture.controller.snapshot().context?.contextKey).toBe(fixture.dictionary.contextKey());
  await fixture.user.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(window.location.hash).toBe('#/ask/new'));
  expect(fixture.calls.filter(call => call.method === 'ontology.publish')).toHaveLength(1);
});

test('retained recovery controls cannot copy or acknowledge after lock, and fresh authority resets the checkbox', async () => {
  const fixture = await hostFixture(true);
  await screen.findByRole('heading', { name: 'Create a workspace for reviewed meanings' });
  fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'SYNTHETIC mounted creation' } });
  fireEvent.change(screen.getByLabelText('Workspace folder'), { target: { value: 'synthetic-mounted' } });
  fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'Synthetic mounted passphrase' } });
  fireEvent.change(screen.getByLabelText('Repeat passphrase'), { target: { value: 'Synthetic mounted passphrase' } });
  await fixture.user.click(screen.getByRole('button', { name: 'Create workspace' }));
  await screen.findByRole('heading', { name: 'Save your recovery kit' });
  await fixture.user.click(screen.getByRole('checkbox', { name: 'I have saved this recovery kit separately.' }));
  const copy = screen.getByRole('button', { name: 'Copy recovery kit' }), enter = screen.getByRole('button', { name: 'Review my business meanings' });
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
  act(() => {
    fixture.controller.invalidate('VAULT_LOCKED');
    expect(copy.isConnected).toBe(true); expect(enter.isConnected).toBe(true);
    copy.click(); enter.click();
  });
  expect(clipboard).not.toHaveBeenCalled(); expect(fixture.controller.snapshot().creation.kind).toBe('recovery-held');
  expect(document.querySelector('[data-first-run-recovery]')).toBeNull();
  expect(JSON.stringify(fixture.controller.snapshot())).not.toContain('SYNTHETIC one-time mounted kit');
  await act(async () => { await fixture.controller.refresh(); });
  await screen.findByRole('heading', { name: 'Save your recovery kit' });
  expect(screen.getByRole('button', { name: 'Review my business meanings' }).hasAttribute('disabled')).toBe(true);
  await fixture.user.click(screen.getByRole('button', { name: 'Copy recovery kit' }));
  expect(clipboard).toHaveBeenCalledTimes(1);
  await fixture.user.click(screen.getByRole('checkbox', { name: 'I have saved this recovery kit separately.' }));
  await fixture.user.click(screen.getByRole('button', { name: 'Review my business meanings' }));
  await screen.findByRole('heading', { name: 'Pick a starter pack' });
});
