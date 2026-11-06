import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { QueueRow } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

/*
 * One-shot C4 task 13: Read draft on Work opens the draft where the owner is, as the message the client gets, with what
 * can be done with it by its state. Nothing goes out from Chausar: WhatsApp and Email open the owner's own app with the
 * text, Copy puts it on the clipboard, Mark delivered records what the owner says they did.
 */

type Seed = Omit<QueueRow, 'digest'>;
const NOW = '2026-10-21T12:00:00.000Z';
const FAILED = 'This draft failed a check: This claim is not in the client\'s files or the run\'s evidence: "Pune Frames". Edit it or reject it.';
const BLOCKED: Seed = {
  id: 'run:d-ep14-script:review-blocked', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Producer', kind: 'draft', createdAt: '2026-10-21T08:30:00.000Z',
  title: 'Draft reply for Boat Audio', line: FAILED, viewRef: { kind: 'draft', id: 'd-ep14-script' },
  actions: [{ id: 'deny', label: 'Reject', primary: false }, { id: 'read', label: 'Read', primary: true }],
};
const WAITING: Seed = { ...BLOCKED, id: 'run:d-ep14-script:review-1', line: 'Read it first.', actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'approve', label: 'Approve', primary: true, requiresView: true }] };
const MARKS = '# Reply\n\n## Summary\nThanks **a lot** for writing.\n\n## Next steps\n- Send the files\n\nRegards,\nAsha';

function start(options: { queue?: Seed[]; text?: string; failed?: boolean; hash?: string } = {}) {
  window.location.hash = options.hash ?? '#/work';
  const engine = new FakeEngine({ now: () => NOW, ...(options.queue ? { queue: options.queue } : {}) });
  engine.reviseDelivery('d-ep14-script', (run) => ({
    ...run, renderedText: options.text ?? MARKS,
    ...(options.failed ? { canAccept: false, acceptBlocked: FAILED, canEdit: true, checks: [{ check: 'faithful', passed: false, detail: 'This claim is not in the client\'s files or the run\'s evidence: "Pune Frames".' }] } : { canAccept: true, canEdit: true }),
  }));
  const client = createFakeClient(engine);
  const request = client.request.bind(client);
  const spy = vi.fn(request);
  client.request = spy as unknown as typeof client.request;
  render(<ClockProvider now={() => new Date(NOW)}><App client={client} language="en" /></ClockProvider>);
  return { engine, spy };
}

const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const press = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); }); await settle(); };
const sheetEl = () => document.querySelector<HTMLElement>('[data-sheet]') ?? document.body;
const orderCard = async () => (await screen.findByText('Two mentions in episode 14')).closest('[data-card]') as HTMLElement;

afterEach(() => { window.location.hash = ''; vi.restoreAllMocks(); });

describe('Read draft on Work (C4 task 13)', () => {
  it('opens the sheet on Work, not Today, as the message with no marks', async () => {
    start({ queue: [WAITING] });
    const card = await orderCard();
    await press(await within(card).findByRole('button', { name: 'Read draft' }));
    expect(window.location.hash).toBe('#/work?sheet=draft%3Ad-ep14-script');
    const message = await waitFor(() => { const found = sheetEl().querySelector<HTMLElement>('[data-draft-message]'); expect(found).toBeTruthy(); return found!; });
    expect(message.textContent).toContain('Thanks a lot for writing.');
    expect(message.textContent).not.toMatch(/[#*]/);
    expect(message.textContent).toContain('Regards,\nAsha');
    assertInkRules(sheetEl());
  });

  it('a waiting draft has Approve, Reject and Edit; Approve goes through the same decide as Today', async () => {
    const { spy } = start({ queue: [WAITING], hash: '#/work?sheet=draft%3Ad-ep14-script' });
    const approve = await within(sheetEl()).findByRole('button', { name: 'Approve' });
    expect(within(sheetEl()).getByRole('button', { name: 'Reject' })).toBeTruthy();
    expect(within(sheetEl()).getByRole('button', { name: 'Edit' })).toBeTruthy();
    await press(approve);
    const call = spy.mock.calls.find(([method]) => method === 'venture.queue.decide')!;
    expect(call[1]).toMatchObject({ id: WAITING.id, action: 'approve', viewed: true });
    await within(sheetEl()).findByRole('button', { name: 'Copy text' });
  });

  it('a draft that failed a check has Edit in Work, which opens the editor here and comes back to the draft', async () => {
    start({ queue: [BLOCKED], failed: true, hash: '#/work?sheet=draft%3Ad-ep14-script' });
    expect(await within(sheetEl()).findByText(/Pune Frames/)).toBeTruthy();
    expect(within(sheetEl()).queryByRole('button', { name: 'Approve' })).toBeNull();
    await press(await within(sheetEl()).findByRole('button', { name: 'Edit in Work' }));
    expect(window.location.hash).toBe(`#/work?sheet=edit-draft%3A${encodeURIComponent(BLOCKED.id)}`);
    const box = await within(sheetEl()).findByRole('textbox', { name: 'Summary' });
    fireEvent.change(box, { target: { value: 'My own summary.' } });
    await press(within(sheetEl()).getByRole('button', { name: 'Save my version' }));
    await waitFor(() => expect(window.location.hash).toBe('#/work?sheet=draft%3Ad-ep14-script'));
    await waitFor(() => expect(sheetEl().querySelector('[data-draft-message]')?.textContent).toContain('My own summary.'));
  });

  it('approved: Copy text puts the plain message on the clipboard', async () => {
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    start({ queue: [WAITING], hash: '#/work?sheet=draft%3Ad-ep14-script' });
    await press(await within(sheetEl()).findByRole('button', { name: 'Approve' }));
    await press(await within(sheetEl()).findByRole('button', { name: 'Copy text' }));
    expect(write).toHaveBeenCalledTimes(1);
    const copied = write.mock.calls[0]![0 as never] as unknown as string;
    expect(copied).toContain('Thanks a lot for writing.');
    expect(copied).not.toMatch(/[#*]/);
    expect(await within(sheetEl()).findByText('Copied. Paste it where you talk to your client.')).toBeTruthy();
  });

  it('approved: WhatsApp and Email open the owner\'s own app with the text, and nothing is sent', async () => {
    const open = vi.fn(async () => {});
    (window as Window & { chausar?: unknown }).chausar = { openExternal: open };
    try {
      const { spy } = start({ queue: [WAITING], hash: '#/work?sheet=draft%3Ad-ep14-script' });
      await press(await within(sheetEl()).findByRole('button', { name: 'Approve' }));
      await press(await within(sheetEl()).findByRole('button', { name: 'Share on WhatsApp' }));
      expect(String(open.mock.calls[0]![0 as never])).toMatch(/^https:\/\/wa\.me\/\?text=/);
      expect(decodeURIComponent(String(open.mock.calls[0]![0 as never]))).toContain('Thanks a lot for writing.');
      await press(within(sheetEl()).getByRole('button', { name: 'Email' }));
      expect(String(open.mock.calls[1]![0 as never])).toMatch(/^mailto:/);
      expect(spy.mock.calls.some(([method]) => /send|post/i.test(String(method)))).toBe(false);
    } finally {
      delete (window as Window & { chausar?: unknown }).chausar;
    }
  });

  it('Mark delivered moves the order on, on the sheet', async () => {
    const { spy } = start({ queue: [WAITING], hash: '#/work?sheet=draft%3Ad-ep14-script' });
    await press(await within(sheetEl()).findByRole('button', { name: 'Approve' }));
    await press(await within(sheetEl()).findByRole('button', { name: 'Mark delivered' }));
    // It asks once more, as the order card does.
    await press(await within(sheetEl()).findByRole('button', { name: 'Mark delivered' }));
    expect(spy.mock.calls.some(([method]) => method === 'venture.order.deliver')).toBe(true);
    const card = await orderCard();
    await waitFor(() => expect(card.textContent).toMatch(/Delivered\./));
    await waitFor(() => expect(within(sheetEl()).queryByRole('button', { name: 'Mark delivered' })).toBeNull());
  });

  it('an approved row on Work has Read draft', async () => {
    start({ queue: [WAITING], hash: '#/work?sheet=draft%3Ad-ep14-script' });
    await press(await within(sheetEl()).findByRole('button', { name: 'Approve' }));
    const card = await orderCard();
    await waitFor(() => expect(within(card).getByRole('button', { name: 'Read draft' })).toBeTruthy());
    expect(within(card).getByRole('button', { name: 'Mark delivered' })).toBeTruthy();
  });

  it('a practice draft reads the same and offers nothing that sends', async () => {
    window.location.hash = '#/work?sheet=draft%3Ad-ep14-script';
    const engine = new FakeEngine({ now: () => NOW, queue: [] });
    engine.reviseDelivery('d-ep14-script', (run) => ({ ...run, renderedText: MARKS, status: 'accepted', practice: true, practiceNow: true }));
    render(<ClockProvider now={() => new Date(NOW)}><App client={createFakeClient(engine)} language="en" /></ClockProvider>);
    expect(await within(sheetEl()).findByText('A practice draft. It never goes to a client.')).toBeTruthy();
    expect(sheetEl().querySelector('[data-draft-message]')?.textContent).toContain('Thanks a lot');
    expect(within(sheetEl()).queryByRole('button', { name: 'Share on WhatsApp' })).toBeNull();
    expect(within(sheetEl()).queryByRole('button', { name: 'Mark delivered' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });
});
