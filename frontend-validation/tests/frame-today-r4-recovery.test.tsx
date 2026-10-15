import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import { createFakeEngine, registerFakeMethods } from '../../app/ui/src/bridge/fake';
import type { FakeEngine } from '../../app/ui/src/bridge/fake';
import { FAKE_RECOVERY_EXPIRES, hostedRecoveryFixture, type HostedRecoveryScript } from '../../app/ui/src/bridge/fixtures/hosted-recovery';
import { AskRecoveryContact } from '../../app/ui/src/screens/first-run/ThisComputer';
import { words } from '../../app/ui/src/text/lanes/frame-today';
import sharedEn from '../../app/ui/src/text/en.json';

// FR-13 "Recover through my contact" on the lock screen, over hosted-link's hosted.recovery.* on the
// fake engine. Everything synthetic; no network.
const PASSPHRASE = 'synthetic-new-passphrase-4821';
const cleanups: Array<() => void> = [];
beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('No network in recovery fixtures')); });
afterEach(() => {
  cleanup();
  for (const done of cleanups.splice(0)) done();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

const w = (key: string, values: Record<string, string> = {}) => {
  const message = words.en[key] ?? (sharedEn as Record<string, string>)[key];
  if (message === undefined) throw Error(`Missing message ${key}`);
  return message.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`);
};
const time = (instant: string) => new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' }).format(new Date(instant));

function setUp(script?: HostedRecoveryScript, absent?: readonly string[]) {
  const engine = createFakeEngine({ scenario: 'locked', ...(absent !== undefined ? { absent } : {}) });
  const fixture = script === undefined ? null : hostedRecoveryFixture(script);
  if (fixture !== null) cleanups.push(registerFakeMethods('hosted', fixture.handlers));
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const port = { request: (method: string, payload: Record<string, unknown> = {}) => { calls.push({ method, payload: structuredClone(payload) }); return (engine as FakeEngine).request(method, payload); } };
  const onRecovered = vi.fn();
  const view = render(<TextProvider language="en"><AskRecoveryContact rpc={port} folder="main" pollMs={5} onRecovered={onRecovered} /></TextProvider>);
  return { calls, fixture, onRecovered, view, user: userEvent.setup() };
}
const phase = () => document.querySelector('[data-ask-recovery-contact]')?.getAttribute('data-recovery-contact');
const ask = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: w('SH-02.contact.btn') }));

test('waiting shows the expiry time and channel, then confirmed asks the passphrase twice, then recovering and recovered', async () => {
  const { calls, fixture, onRecovered, user } = setUp({ channel: 'whatsapp' });
  expect(screen.getByText(w('FR-13.contact.title'))).toBeTruthy();
  await ask(user);
  await screen.findByText(w('FR-13.contact.asked', { channel: w('FR-13.contact.channel.whatsapp'), time: time(FAKE_RECOVERY_EXPIRES) }));
  expect(screen.getByText(w('FR-13.contact.waiting'))).toBeTruthy();
  expect(calls[0]).toEqual({ method: 'hosted.recovery.request', payload: { folder: 'main' } });

  await screen.findByText(w('FR-13.contact.confirmed'));
  expect(calls.filter(call => call.method === 'hosted.recovery.check').length).toBeGreaterThanOrEqual(3);
  const typed = screen.getByLabelText(w('FR-13.contact.passphrase')) as HTMLInputElement;
  const repeated = screen.getByLabelText(w('FR-13.contact.repeat')) as HTMLInputElement;
  expect(typed.type).toBe('password');
  expect(typed.hasAttribute('value')).toBe(false);
  await user.type(typed, PASSPHRASE);
  await user.type(repeated, PASSPHRASE);
  await user.click(screen.getByRole('button', { name: w('FR-13.contact.recover.btn') }));

  // Read once and emptied at once: nowhere in the page after the press.
  await waitFor(() => expect(phase()).not.toBe('confirmed'));
  expect(document.body.innerHTML).not.toContain(PASSPHRASE);
  for (const input of document.querySelectorAll('input')) expect(input.value).not.toContain(PASSPHRASE);
  const sent = calls.filter(call => call.method === 'hosted.recovery.complete');
  expect(sent).toHaveLength(1);
  expect(sent[0]!.payload).toEqual({ requestId: 'rcr_00000000-0000-4000-8000-000000000001', newPassphrase: PASSPHRASE, folder: 'main' });
  expect(fixture!.completions()).toBe(1);

  // VAULT_BUSY while the vault changes reads as still recovering, never as a refusal.
  await screen.findByText(w('FR-13.contact.recovered'));
  expect(document.querySelector('[data-recovery-contact-refused]')).toBeNull();
  expect(document.body.innerHTML).not.toContain(PASSPHRASE);
  await user.click(screen.getByRole('button', { name: w('FR-13.contact.open.btn') }));
  expect(onRecovered).toHaveBeenCalledTimes(1);
  // Polling stops once recovered.
  const checks = calls.length;
  await new Promise(resolve => setTimeout(resolve, 40));
  expect(calls.length).toBe(checks);
});

test('declined, expired and failed each say so in their own words and can start again', async () => {
  for (const [outcome, key] of [['declined', 'FR-13.contact.declined'], ['expired', 'FR-13.contact.expired'], ['failed', 'FR-13.contact.failed']] as const) {
    const { calls, user, view } = setUp({ outcome, waitingChecks: 1 });
    await ask(user);
    await screen.findByText(w(key));
    expect(phase()).toBe(outcome);
    expect(screen.queryByLabelText(w('FR-13.contact.passphrase'))).toBeNull();
    await user.click(screen.getByRole('button', { name: w('FR-13.contact.again.btn') }));
    await waitFor(() => expect(calls.filter(call => call.method === 'hosted.recovery.request')).toHaveLength(2));
    view.unmount();
    for (const done of cleanups.splice(0)) done();
  }
});

test('passphrases that differ say so, send nothing, and empty both fields', async () => {
  const { calls, user } = setUp({ outcome: 'released', waitingChecks: 0 });
  await ask(user);
  await screen.findByText(w('FR-13.contact.confirmed'));
  await user.type(screen.getByLabelText(w('FR-13.contact.passphrase')), PASSPHRASE);
  await user.type(screen.getByLabelText(w('FR-13.contact.repeat')), `${PASSPHRASE}x`);
  await user.click(screen.getByRole('button', { name: w('FR-13.contact.recover.btn') }));
  await screen.findByText(w('FR-13.contact.mismatch'));
  expect(calls.some(call => call.method === 'hosted.recovery.complete')).toBe(false);
  for (const input of document.querySelectorAll('input')) expect(input.value).toBe('');
  expect(document.body.innerHTML).not.toContain(PASSPHRASE);
  // Too short is refused here too, before anything is sent.
  await user.type(screen.getByLabelText(w('FR-13.contact.passphrase')), 'short');
  await user.type(screen.getByLabelText(w('FR-13.contact.repeat')), 'short');
  await user.click(screen.getByRole('button', { name: w('FR-13.contact.recover.btn') }));
  await screen.findByText(w('FR-13.contact.short'));
  expect(calls.some(call => call.method === 'hosted.recovery.complete')).toBe(false);
});

test('a recovery that failed after the key came back asks again; a rejected code says to use the kit', async () => {
  const retry = setUp({ waitingChecks: 0, failure: 'RECOVERY_FAILED', recoveringChecks: 0, busyChecks: 0 });
  await ask(retry.user);
  await screen.findByText(w('FR-13.contact.confirmed'));
  await retry.user.type(screen.getByLabelText(w('FR-13.contact.passphrase')), PASSPHRASE);
  await retry.user.type(screen.getByLabelText(w('FR-13.contact.repeat')), PASSPHRASE);
  await retry.user.click(screen.getByRole('button', { name: w('FR-13.contact.recover.btn') }));
  await screen.findByText(w('FR-13.contact.failure', { code: 'RECOVERY_FAILED' }));
  expect(screen.getByLabelText(w('FR-13.contact.passphrase'))).toBeTruthy();
  retry.view.unmount();
  for (const done of cleanups.splice(0)) done();

  const rejected = setUp({ waitingChecks: 0, failure: 'RECOVERY_CODE_REJECTED', recoveringChecks: 0, busyChecks: 0 });
  await ask(rejected.user);
  await screen.findByText(w('FR-13.contact.confirmed'));
  await rejected.user.type(screen.getByLabelText(w('FR-13.contact.passphrase')), PASSPHRASE);
  await rejected.user.type(screen.getByLabelText(w('FR-13.contact.repeat')), PASSPHRASE);
  await rejected.user.click(screen.getByRole('button', { name: w('FR-13.contact.recover.btn') }));
  await screen.findByText(w('FR-13.contact.code.RECOVERY_CODE_REJECTED'));
  expect(screen.queryByLabelText(w('FR-13.contact.passphrase'))).toBeNull();
});

test('without hosted-link the lock screen keeps frame-today\'s refusal and words', async () => {
  const { calls, user, view } = setUp();
  await ask(user);
  await screen.findByText(w('SH-02.contact.relay'));
  expect(document.querySelector('[data-recovery-contact-answer]')?.getAttribute('data-recovery-contact-answer')).toBe('RECOVERY_CONTACT_RELAY_REQUIRED');
  expect(calls.map(call => call.method)).toEqual(['hosted.recovery.request', 'todayx.recoveryContact.request']);
  view.unmount();

  const none = setUp(undefined, ['todayx.recoveryContact.request']);
  await ask(none.user);
  await screen.findByText(w('SH-02.contact.notBuilt'));
});

test('demo mode and other refusals are said in fixed words, and nothing is polled', async () => {
  const { calls, user } = setUp({ refuseRequest: 'DEMO_EXTERNAL_DISABLED' });
  await ask(user);
  await screen.findByText(w('FR-13.contact.code.DEMO_EXTERNAL_DISABLED'));
  expect(document.querySelector('[data-recovery-contact-refused]')?.getAttribute('data-recovery-contact-refused')).toBe('DEMO_EXTERNAL_DISABLED');
  expect(calls.some(call => call.method === 'hosted.recovery.check')).toBe(false);
  cleanup();
  for (const done of cleanups.splice(0)) done();

  const other = setUp({ refuseRequest: 'SOMETHING_ELSE' });
  await ask(other.user);
  await screen.findByText(w('FR-13.contact.refused', { code: 'SOMETHING_ELSE' }));
});

test('polling stops when the screen goes away', async () => {
  const { calls, user, view } = setUp({ waitingChecks: 1000 });
  await ask(user);
  await waitFor(() => expect(calls.filter(call => call.method === 'hosted.recovery.check').length).toBeGreaterThanOrEqual(2));
  view.unmount();
  const seen = calls.length;
  await new Promise(resolve => setTimeout(resolve, 40));
  expect(calls.length).toBe(seen);
});
