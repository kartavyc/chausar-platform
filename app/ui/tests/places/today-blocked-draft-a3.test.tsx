import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { QueueRow } from '../../src/engine/types';
import { assertInkRules, assertOnePrimary } from '../helpers/ink-rules';

/*
 * One-shot A3 (S2): a draft that failed a check showed only Reject and Read on Today, though its line says "Edit it or
 * reject it." It now offers Send back and Edit like any draft waiting for review, when the engine says the owner may edit
 * it (DeliveryRunView canEdit). Saving the owner's version brings the card back with Approve: the owner's own words are
 * not held to the agent's failed checks. A practice draft offers neither.
 */

type Seed = Omit<QueueRow, 'digest'>;
const NOW = '2026-10-21T12:00:00.000Z';
const FAILED = 'This draft failed a check: This claim is not in the client\'s files or the run\'s evidence: "Pune Frames". Edit it or reject it.';
const BLOCKED: Seed = {
  id: 'run:d-ep14-script:review-blocked', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Producer', kind: 'draft', createdAt: '2026-10-21T08:30:00.000Z',
  title: 'Draft reply for Boat Audio', line: FAILED, viewRef: { kind: 'draft', id: 'd-ep14-script' },
  actions: [{ id: 'deny', label: 'Reject', primary: false }, { id: 'read', label: 'Read', primary: true }],
};
const MINE = 'This episode is brought to you by Boat Audio.\n\nWarmly, the studio';

function start(blocked: { canEdit: boolean }) {
  window.location.hash = '#/today';
  const engine = new FakeEngine({ now: () => NOW, queue: [BLOCKED] });
  engine.reviseDelivery('d-ep14-script', (run) => ({
    ...run, canAccept: false, acceptBlocked: FAILED, canEdit: blocked.canEdit,
    checks: [...(run.checks ?? []), { check: 'faithful', passed: false, detail: 'This claim is not in the client\'s files or the run\'s evidence: "Pune Frames".' }],
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
const cardTitled = async (title: string) => (await screen.findByRole('heading', { level: 3, name: title })).closest('article') as HTMLElement;

afterEach(() => { window.location.hash = ''; });

describe('Today: a draft that failed a check gets Edit, then Approve (A3, S2)', () => {
  it('offers Send back and Edit; Save keeps the owner\'s version, and its card comes back with Approve', async () => {
    const { spy } = start({ canEdit: true });
    const card = await cardTitled('Draft reply for Boat Audio');
    expect(within(card).queryByRole('button', { name: 'Approve' })).toBeNull();
    await waitFor(() => expect(within(card).getByRole('button', { name: 'Edit' })).toBeTruthy());
    expect(within(card).getByRole('button', { name: 'Send back' })).toBeTruthy();
    assertInkRules(document.body);
    assertOnePrimary(card);
    await press(within(card).getByRole('button', { name: 'Edit' }));
    const sheet = document.querySelector<HTMLElement>('[data-sheet]') ?? document.body;
    const text = await within(sheet).findByRole('textbox', { name: 'Your version' }) as HTMLTextAreaElement;
    fireEvent.change(text, { target: { value: MINE } });
    await press(within(sheet).getByRole('button', { name: 'Save my version' }));
    expect(spy.mock.calls.filter(([method]) => method === 'venture.queue.edit').map(([, params]) => params)).toEqual([{ rowId: BLOCKED.id, digest: expect.any(String), text: MINE }]);
    const decided = document.querySelector<HTMLElement>(`[data-row-id="${BLOCKED.id}"][data-decided]`)!;
    expect(decided.textContent).toContain('Your version is kept. Approve it when it is ready.');
    const back = await waitFor(() => {
      const found = screen.getAllByRole('heading', { level: 3, name: 'Draft reply for Boat Audio' }).map((heading) => heading.closest('article') as HTMLElement)
        .find((article) => within(article).queryByRole('button', { name: 'Approve' }));
      expect(found).toBeTruthy();
      return found!;
    });
    expect(back.getAttribute('data-row-id')).not.toBe(BLOCKED.id);
    expect(back.textContent).toContain('Read it, then approve it. You send it yourself.');
  });

  it('a draft the engine does not offer for edit (a practice draft) shows no Send back and no Edit', async () => {
    start({ canEdit: false });
    const card = await cardTitled('Draft reply for Boat Audio');
    await settle();
    expect(within(card).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Send back' })).toBeNull();
    expect(within(card).getByRole('button', { name: 'Reject' })).toBeTruthy();
  });

  it('the fake refuses an edit of a draft its run does not offer, in the engine\'s words', async () => {
    const engine = new FakeEngine({ now: () => NOW, queue: [BLOCKED] });
    engine.reviseDelivery('d-ep14-script', (run) => ({ ...run, canAccept: false, acceptBlocked: 'AI work must finish before you can approve this draft.', canEdit: false }));
    const rows = (await engine.request('venture.queue.list', { scope: 'all' })) as { rows: QueueRow[] };
    const row = rows.rows.find((item) => item.id === BLOCKED.id)!;
    expect(await engine.request('venture.queue.edit', { rowId: row.id, digest: row.digest, text: MINE })).toEqual({ outcome: 'refused', reason: 'NOT_OFFERED', line: 'AI work must finish before you can approve this draft.' });
  });
});

describe('the fake refuses an edit that changes nothing (A3 review, H1)', () => {
  it('the same words with only spaces changed are no edit, in the engine\'s words', async () => {
    const engine = new FakeEngine({ now: () => NOW, queue: [BLOCKED] });
    const run = engine.reviseDelivery('d-ep14-script', (current) => ({ ...current, canAccept: false, acceptBlocked: FAILED, canEdit: true }));
    const rows = (await engine.request('venture.queue.list', { scope: 'all' })) as { rows: QueueRow[] };
    const row = rows.rows.find((item) => item.id === BLOCKED.id)!;
    expect(await engine.request('venture.queue.edit', { rowId: row.id, digest: row.digest, text: `${run.renderedText!}  \n` })).toEqual({ outcome: 'refused', reason: 'NO_CHANGE', line: 'Nothing changed. Edit the words first.' });
  });
});
