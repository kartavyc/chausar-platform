// Wave 6, 6E2 and 6E3: the lesson desk and the booking desk on Work, against the fake engine (which runs the engine's
// own cores). Counts, quotes and deposits come from the engine; a message is opened in the owner's own app only after
// they approve its exact words; Ink rules hold.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TextProvider } from '../../src/text';
import { EngineProvider } from '../../src/engine/context';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { LessonDeskDesk } from '../../src/places/work/desks/LessonDeskDesk';
import { BookingDeskDesk } from '../../src/places/work/desks/BookingDeskDesk';
import { deskReady } from '../../src/places/work/PlaybookDesk';
import { assertInkRules } from '../helpers/ink-rules';

const opened: string[] = [];
beforeEach(() => { opened.length = 0; vi.spyOn(window, 'open').mockImplementation(((url?: string | URL) => { opened.push(String(url ?? '')); return null; }) as typeof window.open); });
afterEach(() => { vi.restoreAllMocks(); });

/** Picks an option once the engine's list has loaded it. */
async function choose(select: HTMLElement, value: string) {
  await waitFor(() => expect(select.querySelector('option[value="' + value + '"]')).not.toBeNull());
  fireEvent.change(select, { target: { value } });
}

async function mount(desk: 'lesson' | 'booking') {
  const client = createFakeClient(new FakeEngine());
  const orders = await client.request('venture.order.list', {});
  const order = orders.find(row => row.status !== 'cancelled' && !row.internal)!;
  render(<TextProvider language="en"><EngineProvider client={client}>{desk === 'lesson' ? <LessonDeskDesk /> : <BookingDeskDesk />}</EngineProvider></TextProvider>);
  return { client, order };
}

describe('lesson desk (6E2)', () => {
  it('is ready on Work', () => { expect(deskReady('lesson-desk')).toBe(true); });

  it('makes a batch, adds a child, marks a class, and shows the engine\'s counts and consent line', async () => {
    const { order } = await mount('lesson');
    fireEvent.click(await screen.findByRole('button', { name: 'New batch' }));
    fireEvent.change(screen.getByLabelText('Batch name'), { target: { value: 'Class 8 maths' } });
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Maths' } });
    fireEvent.click(screen.getByLabelText('Mon'));
    fireEvent.click(screen.getByRole('button', { name: 'Make batch' }));
    await screen.findByRole('heading', { name: 'Class 8 maths' });
    fireEvent.change(screen.getByLabelText('Learner name'), { target: { value: 'Riya Rao' } });
    fireEvent.click(screen.getByLabelText('Under 18'));
    await choose(screen.getByLabelText('Parent or guardian'), order.clientId);
    await choose(screen.getByLabelText('Fee order'), order.id);
    fireEvent.click(screen.getByRole('button', { name: 'Add learner' }));
    await screen.findByText("Record a parent's consent before this child's records reach your AI.");
    fireEvent.change(screen.getByLabelText('Class date'), { target: { value: '2026-10-26' } });
    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'Fractions' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add class' }));
    const mark = await screen.findByLabelText('Riya Rao on 2026-10-26');
    fireEvent.change(mark, { target: { value: 'present' } });
    await screen.findByText('Attended 1 of 1 classes.');
    assertInkRules();
  });

  it('drafts a progress note and opens it in WhatsApp only after the owner approves the exact words', async () => {
    const { order } = await mount('lesson');
    fireEvent.click(await screen.findByRole('button', { name: 'New batch' }));
    fireEvent.change(screen.getByLabelText('Batch name'), { target: { value: 'Yoga mornings' } });
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Yoga' } });
    fireEvent.click(screen.getByLabelText('Sat'));
    fireEvent.click(screen.getByRole('button', { name: 'Make batch' }));
    await screen.findByRole('heading', { name: 'Yoga mornings' });
    fireEvent.change(screen.getByLabelText('Learner name'), { target: { value: 'Meera Iyer' } });
    await choose(screen.getByLabelText('Parent or guardian'), order.clientId);
    fireEvent.click(screen.getByRole('button', { name: 'Add learner' }));
    await screen.findByText('An adult learner. The client AI permission applies.');
    const parent = screen.getByRole('region', { name: 'Parent messages' });
    await choose(within(parent).getByLabelText('Learner'), 'l1');
    fireEvent.change(within(parent).getByLabelText('Send by'), { target: { value: 'whatsapp' } });
    fireEvent.change(within(parent).getByLabelText('Phone'), { target: { value: '+919812345678' } });
    fireEvent.change(within(parent).getByLabelText('Your note'), { target: { value: 'Steady progress.' } });
    fireEvent.click(within(parent).getByRole('button', { name: 'Draft progress note' }));
    await waitFor(() => { expect(parent.querySelector('pre')).not.toBeNull(); });
    const quote = parent.querySelector('pre')!;
    expect(quote.textContent).toMatch(/Steady progress\./);
    expect(quote.closest('[data-content]')).not.toBeNull();
    expect(opened).toEqual([]);
    fireEvent.click(within(parent).getByRole('button', { name: 'Approve and open' }));
    await waitFor(() => expect(opened.some(url => /^https:\/\/wa\.me\/919812345678\?text=/.test(url))).toBe(true));
    await within(parent).findByText('Handed to you to send.');
  });
});

describe('booking desk (6E3)', () => {
  it('is ready on Work', () => { expect(deskReady('booking-desk')).toBe(true); });

  it('adds a slot, takes an enquiry, quotes from the order, holds the slot and drafts the deposit invoice', async () => {
    const { order } = await mount('booking');
    fireEvent.change(await screen.findByLabelText('Start'), { target: { value: '2026-11-05T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add slot' }));
    await screen.findByText('5 Nov 2026 at 10:00');
    fireEvent.click(screen.getByRole('button', { name: 'New enquiry' }));
    await choose(screen.getByLabelText('Client'), order.clientId);
    fireEvent.change(screen.getByLabelText('What they asked for'), { target: { value: 'AC service at home' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save enquiry' }));
    await screen.findByRole('heading', { name: 'AC service at home' });
    await choose(screen.getByLabelText('Order with your price'), order.id);
    fireEvent.click(screen.getByRole('button', { name: 'Quote' }));
    await screen.findByText(/^Quote:/);
    fireEvent.change(screen.getByLabelText('Slot'), { target: { value: (screen.getByLabelText('Slot') as HTMLSelectElement).options[1]!.value } });
    fireEvent.click(screen.getByRole('button', { name: 'Hold slot' }));
    await screen.findByText(/^Held:/);
    fireEvent.change(screen.getByLabelText('Deposit percent'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Draft deposit' }));
    await screen.findByRole('button', { name: 'Issue deposit invoice' });
    assertInkRules();
  });
});
