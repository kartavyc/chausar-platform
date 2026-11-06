import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

/*
 * One-shot C4 task 5: while the open business is paused, Today's paused line carries Unpause (the same
 * venture.business.pause { paused: false } as the business menu), the business name carries a small "Paused" dot, and a
 * card that would start new work keeps its primary locked with the reason. Unpausing takes the line and the dot away.
 */
/** The rows past the compact cards wait behind "Show N more"; a row is a card named by its title. */
async function cardOf(title: string): Promise<HTMLElement> {
  const needsYou = await screen.findByRole('region', { name: 'Needs you' });
  const more = within(needsYou).queryByRole('button', { name: /^Show [0-9]+ more$/ });
  if (more) await act(async () => { fireEvent.click(more); });
  return (await within(needsYou).findByRole('heading', { level: 3, name: title })).closest<HTMLElement>('[data-row]')!;
}

const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

async function start() {
  window.location.hash = '#/today';
  const engine = new FakeEngine({ now: () => '2026-10-23T08:00:00.000Z' });
  const client = createFakeClient(engine);
  await client.request('venture.business.pause', { paused: true });
  render(<ClockProvider now={() => new Date('2026-10-23T13:30:00.000+05:30')}><App client={client} language="en" /></ClockProvider>);
  await screen.findByRole('heading', { level: 1 });
  await settle();
  return { client };
}

describe('Today while paused (C4 task 5)', () => {
  it('shows the paused line with Unpause, a dot by the name, and locks a card that would start work', async () => {
    await start();
    const line = await screen.findByRole('note');
    expect(line.getAttribute('data-paused')).toBe('');
    expect(document.querySelector('[data-paused-dot]')).not.toBeNull();
    const card = await cardOf('Thumbnail set failed');
    const runAgain = Array.from(card.querySelectorAll('button')).find((button) => button.textContent?.includes('Run again'))!;
    expect(runAgain.getAttribute('aria-disabled')).toBe('true');
    expect(card.textContent).toContain('Paused. Unpause to start new work.');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Unpause' })); });
    await settle();
    await waitFor(() => expect(document.querySelector('[data-paused]')).toBeNull());
    expect(screen.getByText('Unpaused. Stopped jobs stay stopped until you resume them.')).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[data-paused-dot]')).toBeNull());
    const after = await cardOf('Thumbnail set failed');
    await waitFor(() => expect(Array.from(after.querySelectorAll('button')).find((button) => button.textContent?.includes('Run again'))!.getAttribute('aria-disabled')).toBeNull());
  });
});
