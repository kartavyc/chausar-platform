import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { MethodName } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

/*
 * W4 4J22a on Money > Journal (from 4J10; catalogue H26): the chain line says whether Chausar's record of outside
 * actions adds up, worded by the screen from the engine's codes; a record that does not add up names the first entry
 * that breaks it, and the owner may accept that break (a second ask, by the digest they saw). "Check a receipt", one
 * step away, checks a stored receipt against its signature (venture.receipt.verify) and shows the engine's line.
 */

type Call = { method: string; params: unknown };

function start(options: { breakAt?: number; language?: 'en' | 'hi' } = {}) {
  window.location.hash = '#/money/journal';
  const engine = new FakeEngine({ now: () => '2026-10-23T10:00:00.000Z' });
  const client = createFakeClient(engine);
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = ((method: MethodName, params?: unknown) => {
    calls.push({ method, params });
    return request(method, params as never);
  }) as typeof client.request;
  if (options.breakAt !== undefined) (engine as unknown as { w4: { quality: { breakChain(seq: number): void } } }).w4.quality.breakChain(options.breakAt);
  render(<App client={client} language={options.language ?? 'en'} />);
  return { calls, client };
}

/** The element once it is there. */
const found = (selector: string) => waitFor(() => {
  const element = document.querySelector(selector);
  expect(element, selector).not.toBeNull();
  return element!;
});

const press = async (scope: HTMLElement, name: string | RegExp) => {
  const button = await within(scope).findByRole('button', { name });
  await act(async () => { fireEvent.click(button); });
};

describe('Money > Journal: the chain line and Check a receipt (4J22a)', () => {
  it('says the record adds up, with how many entries, in the screen words', async () => {
    const { client } = start();
    const entries = (await client.request('venture.journal.list', {})).entries.length;
    const line = (await found('[data-chain]'));
    expect(line.getAttribute('data-chain')).toBe('ok');
    expect(line.textContent).toBe(`Record intact · ${entries} entries, all checked.`);
    assertInkRules();
  });

  it('a record that does not add up names the entry, and accepting the break asks first and sends the digest seen', async () => {
    const { calls, client } = start({ breakAt: 2 });
    const line = (await found('[data-chain="corrupt"]'));
    expect(line.textContent).toBe('Record broken · From entry 2, so nothing more goes out until you look.');
    const seen = (await client.request('venture.journal.chain', {})).digest;
    const box = line.closest('[data-chain-box]') as HTMLElement;
    await press(box, 'Accept this break');
    expect(calls.some((c) => c.method === 'venture.journal.acceptBreak')).toBe(false);
    const ask = box.querySelector('[data-second-ask]') as HTMLElement;
    expect(ask.textContent).toContain('A new record starts after it. What came before is not checked again.');
    await press(ask, 'Accept');
    expect(calls.find((c) => c.method === 'venture.journal.acceptBreak')!.params).toEqual({ digest: seen });
    await waitFor(() => expect(document.querySelector('[data-chain]')!.getAttribute('data-chain')).toBe('ok'));
  });

  it('checks a stored receipt against its signature and shows the engine line', async () => {
    start();
    const fold = (await found('details[data-fold="verify"]')) as HTMLDetailsElement;
    expect(fold.querySelector('summary')!.textContent).toBe('Check a receipt');
    await act(async () => { fold.open = true; });
    fireEvent.change(within(fold).getByLabelText('Receipt number'), { target: { value: 'R-0415' } });
    await press(fold, 'Check');
    await waitFor(() => expect(fold.querySelector('[data-verify]')!.textContent).toBe('Signature matches · Signed by this business and unchanged since. What it was worked out from is kept, so it can be worked out again.'));
  });

  it('a figure worked out on read has no stored receipt to check: the engine says so', async () => {
    start();
    const fold = (await found('details[data-fold="verify"]')) as HTMLDetailsElement;
    await act(async () => { fold.open = true; });
    fireEvent.change(within(fold).getByLabelText('Receipt number'), { target: { value: 'fig:owed' } });
    await press(fold, 'Check');
    await waitFor(() => expect(within(fold).getByRole('alert').textContent).toBe('This figure is worked out again each time it is shown, so there is no stored receipt to sign.'));
  });

  it('only a real mismatch reads as one: a changed receipt says it does not match; one with no signature to check is not confirmed, with why', async () => {
    const cases: [string, string][] = [
      ['changed', "Doesn't match · This receipt does not match its signature: it changed after Chausar signed it."],
      ['unsigned-since', "Doesn't match · This receipt has no signature, though this business signed every receipt made since before it, so it was changed or put in outside Chausar."],
      ['unsigned-old', 'Not confirmed · It was made before Chausar signed receipts, so there is no signature to check.'],
      ['no-key', 'Not confirmed · This business has no signing key here, so its receipts are not signed.'],
      ['key-gone', 'Not confirmed · It was signed with a key no longer kept, so the signature cannot be checked.'],
    ];
    for (const [reason, words] of cases) {
      const engine = new FakeEngine({ now: () => '2026-10-23T10:00:00.000Z' });
      (engine as unknown as { w4: { quality: { verifyAs(id: string, reason: string): void } } }).w4.quality.verifyAs('R-0415', reason);
      window.location.hash = '#/money/journal';
      const { unmount } = render(<App client={createFakeClient(engine)} language="en" />);
      const fold = (await found('details[data-fold="verify"]')) as HTMLDetailsElement;
      await act(async () => { fold.open = true; });
      fireEvent.change(within(fold).getByLabelText('Receipt number'), { target: { value: 'R-0415' } });
      await press(fold, 'Check');
      const said = (await found('[data-verify]'));
      expect(said.textContent, reason).toBe(words);
      expect(said.querySelector('[data-tone]')?.getAttribute('data-tone') ?? said.firstElementChild?.getAttribute('data-tone'), reason).toBe(reason === 'changed' || reason === 'unsigned-since' ? 'fail' : 'neutral');
      unmount();
    }
  });

  it('in Hindi the chain line is worded from its codes', async () => {
    start({ language: 'hi', breakAt: 3 });
    const line = (await found('[data-chain="corrupt"]'));
    expect(line.textContent).toMatch(/3/);
    expect(line.textContent).not.toMatch(/[A-Za-z]{3,}/);
  });
});
