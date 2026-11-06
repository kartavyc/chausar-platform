import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ChatList } from '../../src/places/chats/ChatList';
import { EngineProvider } from '../../src/engine/context';
import { ApprovalRow } from '../../src/parts/ApprovalRow';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { TextProvider } from '../../src/text';
import type { QueueDecision, QueueRow } from '../../src/engine/types';
import { cssOf } from '../helpers/css';

/**
 * One-shot C3 task 13: a decided card leaves on the engine's answer and its line takes the same spot; the first cards of
 * a session come in once; a settled chat leaves its list with data-leaving. All at once with animations off.
 */
const MORNING = () => new Date('2026-10-23T04:30:00.000Z');
const real = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element, pseudo?: string | null) => {
    const style = real(element, pseudo);
    if (!(element instanceof HTMLElement) || !element.hasAttribute('data-leaving')) return style;
    return new Proxy(style, { get: (target, key) => { if (key === 'transitionDuration') return '140ms'; const value = Reflect.get(target, key) as unknown; return typeof value === 'function' ? value.bind(target) : value; } });
  });
});
afterEach(() => { delete document.documentElement.dataset.motion; });

const signoff: QueueRow = {
  id: 'q3', businessId: 'ledgerline', businessName: 'Ledgerline', agent: 'Bookkeeper', kind: 'signoff', createdAt: '2026-10-21T08:00:00Z', digest: 'd3',
  title: 'GST working for September', line: 'Ready for your CA to sign off.',
  actions: [{ id: 'later', label: 'Later', primary: false }, { id: 'send-to-ca', label: 'Send to CA', primary: true }],
} as QueueRow;

describe('a decided card (ApprovalRow)', () => {
  it('stays with data-leaving until its exit ends, only after the engine answered, then the line takes the same spot', async () => {
    let answer: ((decision: QueueDecision) => void) | null = null;
    const onDecide = vi.fn(() => new Promise<QueueDecision>((resolve) => { answer = resolve; }));
    const { container } = render(<TextProvider language="en"><ClockProvider now={MORNING}><ApprovalRow row={signoff} layout="card" onDecide={onDecide} /></ClockProvider></TextProvider>);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to CA' })); });
    // On its way: the card is still here and nothing has left yet.
    expect(container.querySelector('[data-leaving]')).toBeNull();
    expect(screen.getByText('GST working for September')).toBeTruthy();
    await act(async () => { answer!({ outcome: 'done', line: 'Sent to your CA.' }); });
    const card = container.querySelector<HTMLElement>('[data-leaving]');
    expect(card).not.toBeNull();
    expect(container.querySelector('[data-decided]')).toBeNull();
    await act(async () => { fireEvent.transitionEnd(card!); });
    expect(container.querySelector('[data-leaving]')).toBeNull();
    expect(container.querySelector('[data-decided]')?.textContent).toContain('Sent to your CA.');
  });

  it('a refused decision never shows a card that left', async () => {
    const onDecide = vi.fn(async () => ({ outcome: 'refused', reason: 'X', line: 'Refused.' }) as QueueDecision);
    const { container } = render(<TextProvider language="en"><ClockProvider now={MORNING}><ApprovalRow row={signoff} layout="card" onDecide={onDecide} /></ClockProvider></TextProvider>);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to CA' })); });
    expect(container.querySelector('[data-leaving]')).toBeNull();
    expect(screen.getByText('GST working for September')).toBeTruthy();
  });

  it('with animations off, the line comes at once', async () => {
    document.documentElement.dataset.motion = 'off';
    const onDecide = vi.fn(async () => ({ outcome: 'done', line: 'Sent to your CA.' }) as QueueDecision);
    const { container } = render(<TextProvider language="en"><ClockProvider now={MORNING}><ApprovalRow row={signoff} layout="card" onDecide={onDecide} /></ClockProvider></TextProvider>);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to CA' })); });
    expect(container.querySelector('[data-leaving]')).toBeNull();
    expect(container.querySelector('[data-decided]')).not.toBeNull();
  });
});

describe('Today’s cards', () => {
  it('the first arrival of a session staggers; a later visit in the same session does not', async () => {
    const client = createFakeClient(new FakeEngine());
    window.location.hash = '#/today';
    const { unmount } = render(<ClockProvider now={MORNING}><App client={client} language="en" /></ClockProvider>);
    await waitFor(() => expect(document.querySelector('[data-stagger]')).not.toBeNull());
    expect(document.querySelector('[data-stagger] > div > [data-row]')).not.toBeNull();
    expect(cssOf('../places/today/NeedsYou.module.css')).toContain('.cards[data-stagger] > .slot > *');
    unmount();
    render(<ClockProvider now={MORNING}><App client={client} language="en" /></ClockProvider>);
    await waitFor(() => expect(document.querySelector('[data-row]')).not.toBeNull());
    expect(document.querySelector('[data-stagger]')).toBeNull();
  });
});

describe('Chats', () => {
  const thread = (id: string, title: string) => ({ id, title, pinned: false, unread: 0, lastAt: '2026-10-23T04:00:00.000Z', lastLine: '', amounts: [], state: 'active' });
  const resource = (threads: unknown[]) => ({ data: { groups: [{ key: 'today', label: 'Today', threads }], settled: [] }, loading: false, reload: () => {} }) as never;
  const view = (threads: unknown[]) => (
    <EngineProvider client={createFakeClient(new FakeEngine())}><TextProvider language="en"><ClockProvider now={MORNING}><ChatList threads={resource(threads)} selected={undefined} onNew={() => {}} /></ClockProvider></TextProvider></EngineProvider>
  );

  it('a chat that settles leaves its row with data-leaving until the leave ends; a new one arrives', async () => {
    const a = thread('a', 'First chat'), b = thread('b', 'Second chat');
    const { rerender } = render(view([a, b]));
    expect(document.querySelector('nav [data-arriving]')).toBeNull();
    rerender(view([a]));
    const leaving = document.querySelector<HTMLElement>('nav [data-leaving]')!;
    expect(leaving).not.toBeNull();
    expect(leaving.hasAttribute('inert')).toBe(true);
    expect(leaving.textContent).toContain('Second chat');
    await act(async () => { fireEvent.transitionEnd(leaving); });
    expect(document.querySelector('nav [data-leaving]')).toBeNull();
    expect(screen.queryByText('Second chat')).toBeNull();
    rerender(view([a, thread('c', 'Third chat')]));
    expect(screen.getByText('Third chat').closest('[data-arriving]')).not.toBeNull();
  });
});
