import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeEngine } from '../../app/ui/src/bridge/fake';
import { LOCKED_WORKBOOK_BASE64, SYNTHETIC_WORKBOOK_PASSWORD, lockedWorkbookPort, type LockedWorkbookOptions } from '../../app/ui/src/bridge/fixtures/locked-workbook';
import { BringFile, type PickedFile } from '../../app/ui/src/screens/first-run/BringFile';
import { proposalCache } from '../../app/ui/src/screens/first-run/proposals';
import { FirstRunText, firstRunMessages } from '../../app/ui/src/screens/first-run/text';

// FR-07 locked workbooks against core-data's round 4 contract (typed fixture, synthetic bytes, no network).
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('No network in locked-workbook fixtures'));
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
});
afterEach(() => { cleanup(); expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

const w = (key: string, values: Record<string, string> = {}) => {
  const message = firstRunMessages('en')[key];
  if (message === undefined) throw Error(`Missing message ${key}`);
  return message.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`);
};
const LOCKED: PickedFile = { name: 'Locked sales.xlsx', format: 'xlsx', bytesBase64: LOCKED_WORKBOOK_BASE64 };

function flow(options: LockedWorkbookOptions = {}, withProposals = false) {
  const engine = createFakeEngine();
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const inner = lockedWorkbookPort({ request: (method: string, payload?: unknown) => engine.request(method, payload) }, options);
  const port = { request: (method: string, payload: Record<string, unknown> = {}) => { calls.push({ method, payload: structuredClone(payload) }); return inner.request(method, payload); } };
  const taken = vi.fn();
  const view = render(
    <FirstRunText language="en">
      <BringFile rpc={port as never} pickFile={async () => LOCKED} held={null} onHold={() => {}} meaningsAgreed company="Demo shop" onTaken={taken} onWaits={() => {}}
        {...(withProposals ? { propose: proposalCache(port as never) } : {})} />
    </FirstRunText>,
  );
  return { calls, taken, container: view.container, user: userEvent.setup() };
}

/** Every string held anywhere in React's committed tree: hook state, update queues and props. */
function reactHolds(container: HTMLElement, secret: string): boolean {
  const key = Object.keys(container).find(name => name.startsWith('__reactContainer$'));
  if (key === undefined) throw Error('No React root on the container.');
  const seen = new WeakSet<object>();
  const holds = (value: unknown, depth: number): boolean => {
    if (typeof value === 'string') return value.includes(secret);
    if (value === null || typeof value !== 'object' || depth > 40 || value instanceof Node || seen.has(value)) return false;
    seen.add(value);
    return Object.entries(value).some(([name, inner]) => name !== 'return' && name !== '_owner' && name !== 'stateNode' && holds(inner, depth + 1));
  };
  return holds((container as unknown as Record<string, unknown>)[key], 0);
}

async function typeAndSend(user: ReturnType<typeof userEvent.setup>, password: string, button: string) {
  const field = screen.getByLabelText(w('FR-07.password')) as HTMLInputElement;
  await user.type(field, password);
  await user.click(screen.getByRole('button', { name: button }));
  // Read once and emptied at once.
  expect(field.value).toBe('');
}

test('FR-07: a locked workbook is sent as normal, asks for its password once, empties the field, and the password is never in the page, React state or another request', { timeout: 20000 }, async () => {
  const { calls, taken, container, user } = flow({}, true);
  await user.click(await screen.findByRole('button', { name: w('FR-07.pick.btn') }));
  await screen.findByRole('heading', { name: w('FR-07.password.title') });
  expect(screen.getByText(w('FR-07.password.note'))).toBeTruthy();
  expect(screen.queryByText(w('FR-07.password.notBuilt'))).toBeNull();
  // The first read carries no password: the engine asked for one.
  expect(Object.keys(calls.find(call => call.method === 'sources.workbookPreview')!.payload)).toEqual(['sourceId', 'bytesBase64']);

  await typeAndSend(user, 'not-it', w('FR-07.password.send.btn'));
  await screen.findByText(w('FR-07.password.wrong'));
  await typeAndSend(user, SYNTHETIC_WORKBOOK_PASSWORD, w('FR-07.password.send.btn'));
  await screen.findByText(w('FR-07.password.again'));
  expect(document.body.innerHTML).not.toContain(SYNTHETIC_WORKBOOK_PASSWORD);
  expect(reactHolds(container, SYNTHETIC_WORKBOOK_PASSWORD)).toBe(false);
  // The scan does see what React holds: the file's bytes are in state.
  expect(reactHolds(container, LOCKED_WORKBOOK_BASE64)).toBe(true);

  // Taking it in asks once more, for the one import.
  await typeAndSend(user, SYNTHETIC_WORKBOOK_PASSWORD, w('FR-07.take.btn'));
  await screen.findByRole('button', { name: w('FR.journey.continue.btn') });
  await screen.findByText(w('FR-07.proposals.locked'));
  expect(document.body.innerHTML).not.toContain(SYNTHETIC_WORKBOOK_PASSWORD);
  expect(reactHolds(container, SYNTHETIC_WORKBOOK_PASSWORD)).toBe(false);

  const sent = calls.filter(call => Object.hasOwn(call.payload, 'password'));
  expect(sent.map(call => [call.method, call.payload['password']])).toEqual([
    ['sources.workbookPreview', 'not-it'], ['sources.workbookPreview', SYNTHETIC_WORKBOOK_PASSWORD], ['sources.workbookImport', SYNTHETIC_WORKBOOK_PASSWORD],
  ]);
  // The proposals read is asked without it and says so in words.
  expect(calls.find(call => call.method === 'sources.workbook')?.payload).toEqual({ bytesBase64: LOCKED_WORKBOOK_BASE64 });
  expect(calls.some(call => !Object.hasOwn(call.payload, 'password') && JSON.stringify(call.payload).includes(SYNTHETIC_WORKBOOK_PASSWORD))).toBe(false);
  await user.click(screen.getByRole('button', { name: w('FR.journey.continue.btn') }));
  expect(taken).toHaveBeenCalledTimes(1);
});

test('FR-07: a wrong password at the import asks again with its words; a password the engine cannot take is refused in words, here or by the engine', { timeout: 20000 }, async () => {
  const { calls, user } = flow();
  await user.click(await screen.findByRole('button', { name: w('FR-07.pick.btn') }));
  await screen.findByRole('heading', { name: w('FR-07.password.title') });

  // Longer than 255 characters: not sent.
  const field = screen.getByLabelText(w('FR-07.password')) as HTMLInputElement;
  fireEvent.change(field, { target: { value: 'x'.repeat(256) } });
  fireEvent.submit(field.form!);
  await screen.findByText(w('FR-07.password.invalid.sheet'));
  expect(field.value).toBe('');
  expect(calls.filter(call => Object.hasOwn(call.payload, 'password'))).toEqual([]);

  // A lone surrogate is not in the engine's shape either: caught before sending, same words.
  const again = screen.getByLabelText(w('FR-07.password')) as HTMLInputElement;
  fireEvent.change(again, { target: { value: 'ok\uDC00' } });
  const shapeSent = calls.length;
  fireEvent.submit(again.form!);
  await waitFor(() => expect(screen.getByText(w('FR-07.password.invalid.sheet'))).toBeTruthy());
  expect(calls.length).toBe(shapeSent);

  await typeAndSend(user, SYNTHETIC_WORKBOOK_PASSWORD, w('FR-07.password.send.btn'));
  await screen.findByText(w('FR-07.password.again'));
  await typeAndSend(user, 'not-it', w('FR-07.take.btn'));
  await screen.findByText(w('FR-07.password.wrong'));
  expect(screen.queryByRole('button', { name: w('FR.journey.continue.btn') })).toBeNull();
  await typeAndSend(user, SYNTHETIC_WORKBOOK_PASSWORD, w('FR-07.take.btn'));
  await screen.findByRole('button', { name: w('FR.journey.continue.btn') });
});

test('FR-07: an engine-side WORKBOOK_PASSWORD_INVALID shows its fixed words and asks again', { timeout: 20000 }, async () => {
  const engine = createFakeEngine();
  let first = true;
  const inner = lockedWorkbookPort({ request: (method: string, payload?: unknown) => engine.request(method, payload) });
  // The engine's own shape rule can differ from the screen's (for example a future limit): its refusal is shown the same way.
  const port = { request: (method: string, payload: Record<string, unknown> = {}) => {
    if (method === 'sources.workbookPreview' && Object.hasOwn(payload, 'password') && first) { first = false; return Promise.reject(Object.assign(Error('x'), { code: 'WORKBOOK_PASSWORD_INVALID' })); }
    return inner.request(method, payload);
  } };
  render(<FirstRunText language="en"><BringFile rpc={port as never} pickFile={async () => LOCKED} held={null} onHold={() => {}} meaningsAgreed company="Demo shop" onTaken={() => {}} onWaits={() => {}} /></FirstRunText>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: w('FR-07.pick.btn') }));
  await screen.findByRole('heading', { name: w('FR-07.password.title') });
  await typeAndSend(user, SYNTHETIC_WORKBOOK_PASSWORD, w('FR-07.password.send.btn'));
  await screen.findByText(w('FR-07.password.invalid.sheet'));
  await typeAndSend(user, SYNTHETIC_WORKBOOK_PASSWORD, w('FR-07.password.send.btn'));
  await screen.findByText(w('FR-07.password.again'));
});

test('FR-07: core-data\'s other locked-workbook refusals have their own words', { timeout: 20000 }, async () => {
  for (const code of ['WORKBOOK_ENCRYPTION_UNSUPPORTED', 'WORKBOOK_INTEGRITY_FAILED'] as const) {
    const { user } = flow({ refuse: code });
    await user.click(await screen.findByRole('button', { name: w('FR-07.pick.btn') }));
    if (code === 'WORKBOOK_INTEGRITY_FAILED') {
      await screen.findByRole('heading', { name: w('FR-07.password.title') });
      await typeAndSend(user, SYNTHETIC_WORKBOOK_PASSWORD, w('FR-07.password.send.btn'));
    }
    await screen.findByText(w(`FR-07.locked.${code}`));
    expect(document.querySelector(`[data-whole-reason="${code}"]`)).not.toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    cleanup();
  }
});
