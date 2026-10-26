import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type EngineClient } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

/*
 * W4 4J22a on a Work order (from 4J12, catalogue H24): the order's contract, its goal, scope, limits, what is kept as it
 * is (protected phrases and files), what it delivers and its checks, each with its state, and Sign with a second ask.
 * The owner signs the revision they read, by its digest; a changed contract is refused in the engine's words and read
 * again. Today says the order waits for its contract, until it is signed. An order with no contract shows none. The
 * sample's contract sits on Ledgerline's October books order, which no run has started.
 */

type Edit = (method: string, params: Record<string, unknown>) => Promise<unknown> | undefined;

/** Rendering the whole app on a slow machine can pass five seconds; these tests wait longer rather than flake. */
const SLOW = { timeout: 20_000 };

async function start(order = 'o-iyer-oct', edit?: Edit) {
  const fake = createFakeClient(new FakeEngine({ now: () => '2026-10-26T10:42:00.000Z' }));
  await fake.request('workspace.open', { folder: 'ledgerline' });
  window.location.hash = `#/work?order=${order}`;
  const calls: { method: string; params: unknown }[] = [];
  const client: EngineClient = {
    ...fake,
    request: (async (method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params });
      return (edit?.(method, params ?? {})) ?? fake.request(method as never, params as never);
    }) as EngineClient['request'],
  };
  render(<App client={client} language="en" />);
  return { calls, fake };
}

describe('Work: the order contract (4J22a)', SLOW, () => {
  it('shows the contract waiting to be signed: goal, scope, kept items, deliverables and checks with their states', async () => {
    await start();
    const tile = await screen.findByRole('region', { name: 'Contract' }, SLOW);
    expect(tile.querySelector('[data-goal]')!.textContent).toBe('October books that match the bank statement line by line.');
    expect(tile.querySelector('[data-goal]')!.closest('[data-content]')).not.toBeNull();
    expect(tile.querySelector('[data-contract-line]')!.textContent).toBe('Revision 1 waits for you to sign it. No work starts on this order until you do.');
    expect([...tile.querySelectorAll('[data-part="scope"] li')].map((li) => li.textContent)).toEqual([
      'Record every bank line for October.', 'Match each sale to its invoice.',
    ]);
    expect([...tile.querySelectorAll('[data-part="protected"] li')].map((li) => li.textContent)).toEqual([
      'Phrase: Opening balance as the client confirmed it', 'File: iyer-bank-october.csv',
    ]);
    expect([...tile.querySelectorAll('[data-part="deliverables"] li')].map((li) => li.textContent)).toEqual([
      'Open: The October books with the bank reconciliation. Done when: You accept the books.',
    ]);
    expect([...tile.querySelectorAll('[data-part="checks"] li')].map((li) => li.textContent)).toEqual([
      'Open: Every bank line is matched or listed as open.', 'Open: The opening balance line is unchanged.',
    ]);
    assertInkRules(tile);
  });

  it('Today says the order waits for its contract, in the engine words, until it is signed', async () => {
    const { fake } = await start();
    const rows = (await fake.request('venture.queue.list', { scope: 'all' })).rows.filter((row) => row.id.startsWith('contract:'));
    expect(rows.map((row) => [row.kind, row.title, row.line, row.actions.map((a) => a.label)])).toEqual([[
      'notice', 'Sign the contract for an order', "Iyer & Co's order waits for a contract you sign. No work starts on it until you do.", ['Later', 'Open the order'],
    ]]);
    const read = (await fake.request('venture.order.contract', { orderId: 'o-iyer-oct' }))!;
    await act(async () => { await fake.request('venture.order.contract.sign', { orderId: 'o-iyer-oct', digest: read.digest }); });
    expect((await fake.request('venture.queue.list', { scope: 'all' })).rows.some((row) => row.id.startsWith('contract:'))).toBe(false);
  });

  it('Sign asks a second time, then signs the revision read, by its digest', async () => {
    const { calls, fake } = await start();
    const tile = await screen.findByRole('region', { name: 'Contract' }, SLOW);
    const read = (await fake.request('venture.order.contract', { orderId: 'o-iyer-oct' }))!;
    await act(async () => { fireEvent.click(within(tile).getByRole('button', { name: 'Sign' })); });
    expect(calls.some((c) => c.method === 'venture.order.contract.sign')).toBe(false);
    const ask = tile.querySelector('[data-second-ask]')!;
    expect(ask.textContent).toContain('Sign revision 1? Work on this order follows it, and every draft is checked against what it keeps as it is.');
    expect(document.activeElement).toBe(within(ask as HTMLElement).getByRole('button', { name: 'Not now' }));
    await act(async () => { fireEvent.click(within(ask as HTMLElement).getByRole('button', { name: 'Sign revision 1' })); });
    const signed = calls.find((c) => c.method === 'venture.order.contract.sign')!;
    expect(signed.params).toEqual({ orderId: 'o-iyer-oct', digest: read.digest });
    await waitFor(() => expect(tile.querySelector('[data-contract-line]')!.textContent).toBe('You signed revision 1. Work on this order follows it.'), SLOW);
    expect(within(tile).queryByRole('button', { name: 'Sign' })).toBeNull();
    // Signed, what it covers folds one step away.
    expect((tile.querySelector('details[data-fold="contract"]') as HTMLDetailsElement).open).toBe(false);
  });

  it('a contract that changed since it was read is refused in the engine words, and the newest is read again', async () => {
    let reads = 0;
    await start('o-iyer-oct', (method) => {
      if (method === 'venture.order.contract') reads += 1;
      return method === 'venture.order.contract.sign' ? Promise.reject(new EngineError('APPROVAL_STALE', 'This contract changed since you read it. Read it again, then sign.')) : undefined;
    });
    const tile = await screen.findByRole('region', { name: 'Contract' }, SLOW);
    const before = reads;
    await act(async () => { fireEvent.click(within(tile).getByRole('button', { name: 'Sign' })); });
    await act(async () => { fireEvent.click(within(tile).getByRole('button', { name: 'Sign revision 1' })); });
    await waitFor(() => expect(within(tile).getByRole('alert').textContent).toBe("Couldn't sign: This contract changed since you read it. Read it again, then sign."), SLOW);
    expect(reads).toBeGreaterThan(before);
  });

  it('an order with no contract shows none', async () => {
    await start('o-mehta-sep');
    await screen.findByRole('region', { name: 'A file from your client' }, SLOW);
    expect(screen.queryByRole('region', { name: 'Contract' })).toBeNull();
  });
});
