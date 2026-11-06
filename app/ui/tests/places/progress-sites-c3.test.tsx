import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';

/**
 * One-shot C3 task 11: AI work shows real progress where it runs. Rehearse lists the practice clients up front and they
 * tick from the fake's frames; making an app and a chat reply each show one still line with their time; nothing spins.
 */
const MORNING = () => new Date('2026-10-23T04:30:00.000Z');

function start(hash: string, engine = new FakeEngine({ workDelayMs: 40 })) {
  window.location.hash = hash;
  const client = createFakeClient(engine);
  render(<ClockProvider now={MORNING}><App client={client} language="en" /></ClockProvider>);
  return { engine, client };
}

describe('progress where the work runs', () => {
  it('Rehearse lists the practice clients up front, and they tick from the frames', async () => {
    start('#/business/practice');
    const rehearse = await screen.findByRole('button', { name: /^Rehearse/ });
    await act(async () => { fireEvent.click(rehearse); });
    const progress = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-progress="rehearse"]');
      expect(found).not.toBeNull();
      return found!;
    });
    const rows = within(progress).getAllByRole('listitem');
    expect(rows.length).toBeGreaterThan(1);
    expect(within(progress).getByRole('link', { name: 'Keep working' })).toBeTruthy();
    await waitFor(() => expect(rows.some((row) => row.dataset.state === 'done' || !row.isConnected)).toBe(true), { timeout: 3000 });
  });

  it('making an app says "Writing your app" while it runs, never "Your AI is writing it."', async () => {
    const engine = new FakeEngine();
    const client = createFakeClient(engine);
    const request = client.request.bind(client);
    let finish: (() => void) | null = null;
    const slow: EngineClient = {
      ...client,
      request: (async (method: string, params: unknown) => {
        if (method === 'venture.apps.make') await new Promise<void>((resolve) => { finish = resolve; });
        return request(method as never, params as never);
      }) as EngineClient['request'],
    };
    window.location.hash = '#/apps';
    render(<ClockProvider now={MORNING}><App client={slow} language="en" /></ClockProvider>);
    const box = await screen.findByRole('textbox', { name: /app/i });
    fireEvent.change(box, { target: { value: 'A list of who owes me money' } });
    await act(async () => { fireEvent.submit(box.closest('form')!); });
    await waitFor(() => expect(document.querySelector('[data-wait-line]')?.textContent).toMatch(/^Writing your app/));
    expect(screen.queryByText('Your AI is writing it.')).toBeNull();
    await act(async () => { finish!(); });
  });

  it('a chat waits with a still "Writing" line, and no three-dot loop', async () => {
    const engine = new FakeEngine();
    const client = createFakeClient(engine);
    const request = client.request.bind(client);
    let finish: (() => void) | null = null;
    const slow: EngineClient = {
      ...client,
      request: (async (method: string, params: unknown) => {
        if (method === 'venture.chief.thread.send') await new Promise<void>((resolve) => { finish = resolve; });
        return request(method as never, params as never);
      }) as EngineClient['request'],
    };
    window.location.hash = '#/chats/new';
    render(<ClockProvider now={MORNING}><App client={slow} language="en" /></ClockProvider>);
    const box = (await screen.findAllByRole('textbox')).find((item) => item.tagName === 'TEXTAREA')!;
    fireEvent.change(box, { target: { value: 'How much did we invoice this month?' } });
    await act(async () => { fireEvent.submit(box.closest('form')!); });
    await waitFor(() => expect(document.querySelector('[data-wait-line]')?.textContent).toMatch(/^Writing/));
    await act(async () => { finish?.(); });
  });
});
