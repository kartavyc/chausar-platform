import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { QueueRow } from '../../src/engine/types';

/*
 * One-shot C4 task 14: the draft editor shows plain sections, one labelled box each, and saves the Markdown the engine
 * keeps. A draft with formatting the simple editor can't keep stays in one box with a line that says so.
 */

type Seed = Omit<QueueRow, 'digest'>;
const NOW = '2026-10-21T12:00:00.000Z';
const ROW: Seed = {
  id: 'run:d-ep14-script:review-1', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Producer', kind: 'draft', createdAt: '2026-10-21T08:30:00.000Z',
  title: 'Draft reply for Boat Audio', line: 'Read it first.', viewRef: { kind: 'draft', id: 'd-ep14-script' },
  actions: [{ id: 'deny', label: 'Reject', primary: false }, { id: 'approve', label: 'Approve', primary: true }],
};
const TEMPLATE = "Template outline. No AI wrote this and it doesn't read the client's request.\n\n# Reply outline\n\n## Summary\nThanks for your message.\n\n## What we will make\nWe will make the pieces.\n\n## Next steps\nOnce you answer, we start.\n\nQuestions for you:\n- Is anything missing?";

function start(text: string) {
  window.location.hash = `#/today?sheet=edit-draft:${ROW.id}`;
  const engine = new FakeEngine({ now: () => NOW, queue: [ROW] });
  engine.reviseDelivery('d-ep14-script', (run) => ({ ...run, renderedText: text, canEdit: true }));
  const client = createFakeClient(engine);
  const request = client.request.bind(client);
  const spy = vi.fn(request);
  client.request = spy as unknown as typeof client.request;
  render(<ClockProvider now={() => new Date(NOW)}><App client={client} language="en" /></ClockProvider>);
  return { spy };
}

const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const sheetEl = () => document.querySelector<HTMLElement>('[data-sheet]') ?? document.body;

afterEach(() => { window.location.hash = ''; });

describe('the draft editor (C4 task 14)', () => {
  it('shows one labelled box per section with no Markdown marks', async () => {
    start(TEMPLATE);
    const summary = await within(sheetEl()).findByRole('textbox', { name: 'Summary' }) as HTMLTextAreaElement;
    expect(summary.value).toBe('Thanks for your message.');
    expect(within(sheetEl()).getByRole('textbox', { name: 'What we will make' })).toBeTruthy();
    const next = within(sheetEl()).getByRole('textbox', { name: 'Next steps' }) as HTMLTextAreaElement;
    expect(next.value).toContain('• Is anything missing?');
    const words = [...sheetEl().querySelectorAll('textarea')].map((box) => box.value).join('\n');
    expect(words).not.toMatch(/^#/m);
    expect(words).not.toContain('Template outline');
  });

  it('saves the Markdown the engine keeps', async () => {
    const { spy } = start(TEMPLATE);
    const box = await within(sheetEl()).findByRole('textbox', { name: 'What we will make' });
    fireEvent.change(box, { target: { value: 'We will make the pieces, in your style.\n• And a list' } });
    await act(async () => { fireEvent.click(within(sheetEl()).getByRole('button', { name: 'Save my version' })); });
    await settle();
    const call = spy.mock.calls.find(([method]) => method === 'venture.queue.edit')!;
    expect((call[1] as { text: string }).text).toBe(TEMPLATE.replace('We will make the pieces.', 'We will make the pieces, in your style.\n- And a list'));
  });

  it('Save stays off until the words change', async () => {
    start(TEMPLATE);
    await within(sheetEl()).findByRole('textbox', { name: 'Summary' });
    expect((within(sheetEl()).getByRole('button', { name: 'Save my version' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a draft with a table stays in one box and says why', async () => {
    const table = '## Summary\n| a | b |\n|---|---|\n| 1 | 2 |';
    start(table);
    const box = await within(sheetEl()).findByRole('textbox', { name: 'Your version' }) as HTMLTextAreaElement;
    expect(box.value).toBe(table);
    expect(screen.getByText("This draft has formatting the simple editor can't keep.")).toBeTruthy();
  });

  it('a draft with no headings is one box, as before', async () => {
    start('Plain words only.\n\nA second paragraph.');
    const box = await within(sheetEl()).findByRole('textbox', { name: 'Your version' }) as HTMLTextAreaElement;
    expect(box.value).toBe('Plain words only.\n\nA second paragraph.');
    expect(screen.queryByText("This draft has formatting the simple editor can't keep.")).toBeNull();
  });
});
