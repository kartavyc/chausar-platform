import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type MethodName } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

/*
 * W4 4J22a, Business > Routines (from 4J13; catalogue A12): each routine with its schedule in words and its time zone
 * (never cron), who it asks, the engine's line on its next run, and its history, where a finished run says Delivered,
 * never Done. Adding, turning off and removing each ask a second time; a prompt that leans on a chat ("like before")
 * is refused in the engine's words, since a routine runs without the chat.
 */

type Call = { method: string; params: unknown };

function start(intercept: Partial<Record<MethodName, (params: unknown) => unknown>> = {}, language: 'en' | 'hi' = 'en') {
  window.location.hash = '#/business/routines';
  const client = createFakeClient(new FakeEngine({ now: () => '2026-10-23T10:00:00.000Z' }));
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = ((method: MethodName, params?: unknown) => {
    calls.push({ method, params });
    const own = intercept[method];
    if (own) return Promise.resolve().then(() => own(params));
    return request(method, params as never);
  }) as typeof client.request;
  render(<App client={client} language={language} />);
  return { calls };
}

const press = async (scope: HTMLElement, name: string | RegExp) => {
  const button = await within(scope).findByRole('button', { name });
  await act(async () => { fireEvent.click(button); });
};

describe('Business > Routines (4J22a)', () => {
  it('lists each routine with its schedule and time zone, who it asks, and the next run in the engine words', async () => {
    start();
    expect(await screen.findByRole('heading', { level: 1, name: 'Routines' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Business pages' });
    expect(within(nav).getByRole('link', { name: 'Routines' }).getAttribute('aria-current')).toBe('page');
    const item = await screen.findByRole('article', { name: 'Weekly review' });
    expect(item.querySelector('[data-when]')!.textContent).toBe('Every Monday 09:00, Asia/Kolkata');
    expect(item.querySelector('[data-asks]')!.textContent).toBe('Asks Chausar');
    // Worded by the screen from routine.on and routine.next, in the routine's own time zone.
    expect(item.querySelector('[data-routine-line]')!.textContent).toBe('Next run 26 Oct, 09:00');
    assertInkRules();
  });

  it('its history says Delivered for a finished run, never Done, with the engine line', async () => {
    start();
    const item = await screen.findByRole('article', { name: 'Weekly review' });
    const fold = item.querySelector('details[data-fold="history"]') as HTMLDetailsElement;
    await act(async () => { fold.open = true; fold.dispatchEvent(new Event('toggle')); });
    await waitFor(() => expect(fold.querySelectorAll('li')).toHaveLength(2));
    const lines = [...fold.querySelectorAll('li')].map((li) => li.textContent);
    expect(lines[0]).toBe('Delivered, 20 Oct 2026');
    expect(lines[1]).toMatch(/^Missed: Missed once while Chausar was closed\./);
    expect(fold.textContent).not.toMatch(/\bDone\b/);
  });

  it('adds a routine on weekdays at a time in a time zone, after a second ask', async () => {
    const { calls } = start();
    await screen.findByRole('article', { name: 'Weekly review' });
    const form = screen.getByRole('form', { name: 'Add a routine' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Morning check' } });
    fireEvent.change(within(form).getByLabelText('What to ask'), { target: { value: 'List the invoices that fell due this week and who has not paid.' } });
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Monday' }));
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Wednesday' }));
    fireEvent.change(within(form).getByLabelText('Time'), { target: { value: '08:30' } });
    expect((within(form).getByLabelText('Time zone') as HTMLInputElement).value).toBe('Asia/Kolkata');
    await press(form, 'Save routine');
    expect(calls.some((c) => c.method === 'venture.routines.set')).toBe(false);
    const ask = form.querySelector('[data-second-ask]') as HTMLElement;
    expect(ask.textContent).toContain('Each run waits for your approval on Today before anything goes to your AI. Save it?');
    await press(ask, 'Save');
    const set = calls.find((c) => c.method === 'venture.routines.set')!;
    expect(set.params).toEqual({ routine: {
      name: 'Morning check', agent: null, prompt: 'List the invoices that fell due this week and who has not paid.', on: true,
      schedule: { kind: 'calendar', weekdays: [1, 3], time: '08:30', timeZone: 'Asia/Kolkata' },
    } });
    const added = await screen.findByRole('article', { name: 'Morning check' });
    expect(added.querySelector('[data-when]')!.textContent).toBe('Every Monday and Wednesday 08:30, Asia/Kolkata');
  });

  it('a prompt that leans on the chat is refused in the engine words', async () => {
    start({ 'venture.routines.set': () => { throw new EngineError('ROUTINE_NOT_STANDALONE', 'A routine runs without the chat, so "like before" would point at nothing. Say in full what you want each time.'); } });
    await screen.findByRole('article', { name: 'Weekly review' });
    const form = screen.getByRole('form', { name: 'Add a routine' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Again' } });
    fireEvent.change(within(form).getByLabelText('What to ask'), { target: { value: 'Do the report like before, please.' } });
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Friday' }));
    await press(form, 'Save routine');
    await press(form.querySelector('[data-second-ask]') as HTMLElement, 'Save');
    await waitFor(() => expect(within(form).getByRole('alert').textContent).toBe("Couldn't save it: A routine runs without the chat, so \"like before\" would point at nothing. Say in full what you want each time."));
  });

  it('turns a routine off and on again, each after a second ask, sending its own words back', async () => {
    const { calls } = start();
    const item = await screen.findByRole('article', { name: 'Weekly review' });
    await press(item, 'Turn off');
    expect(calls.some((c) => c.method === 'venture.routines.set')).toBe(false);
    const ask = item.querySelector('[data-second-ask]') as HTMLElement;
    expect(ask.textContent).toContain('Turn it off? Nothing runs until you turn it on again.');
    await press(ask, 'Turn off');
    const sent = calls.find((c) => c.method === 'venture.routines.set')!.params as { routine: Record<string, unknown> };
    expect(sent.routine).toMatchObject({ id: 'routine-weekly', name: 'Weekly review', agent: null, on: false, schedule: { kind: 'calendar', weekdays: [1], time: '09:00', timeZone: 'Asia/Kolkata' } });
    expect(sent.routine.prompt).toMatch(/^Give me a weekly review of my business/);
    await waitFor(() => expect(screen.getByRole('article', { name: 'Weekly review' }).querySelector('[data-routine-line]')!.textContent).toBe('Off. Nothing runs.'));
    const off = screen.getByRole('article', { name: 'Weekly review' });
    await press(off, 'Turn on');
    expect((off.querySelector('[data-second-ask]') as HTMLElement).textContent).toContain('Turn it on? Each run waits for your approval on Today.');
    await press(off.querySelector('[data-second-ask]') as HTMLElement, 'Turn on');
    await waitFor(() => expect(screen.getByRole('article', { name: 'Weekly review' }).querySelector('[data-routine-line]')!.textContent).toMatch(/^Next run /));
  });

  it('changes a routine in its own form, prefilled, after a second ask', async () => {
    const { calls } = start();
    const item = await screen.findByRole('article', { name: 'Weekly review' });
    await press(item, 'Change');
    const form = within(item).getByRole('form', { name: 'Change Weekly review' });
    expect((within(form).getByLabelText('What to ask') as HTMLTextAreaElement).value).toMatch(/^Give me a weekly review/);
    expect((within(form).getByRole('checkbox', { name: 'Monday' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Monday review' } });
    await press(form, 'Save routine');
    await press(form.querySelector('[data-second-ask]') as HTMLElement, 'Save');
    expect(calls.find((c) => c.method === 'venture.routines.set')!.params).toMatchObject({ routine: { id: 'routine-weekly', name: 'Monday review', on: true } });
    expect(await screen.findByRole('article', { name: 'Monday review' })).toBeTruthy();
  });

  it('removes a routine after a second ask; its history stays', async () => {
    const { calls } = start();
    const item = await screen.findByRole('article', { name: 'Weekly review' });
    await press(item, 'Remove');
    expect(calls.some((c) => c.method === 'venture.routines.remove')).toBe(false);
    const ask = item.querySelector('[data-second-ask]') as HTMLElement;
    expect(ask.textContent).toContain('Remove Weekly review? Its history stays.');
    await press(ask, 'Remove');
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Weekly review' })).toBeNull());
    expect(screen.getAllByRole('status').map((el) => el.textContent)).toContain('Weekly review is removed. Its history stays.');
  });

  it('in Hindi, the schedule is worded from its codes', async () => {
    start({}, 'hi');
    const item = await screen.findByRole('article', { name: 'Weekly review' });
    expect(item.querySelector('[data-when]')!.textContent).toBe('हर सोमवार 09:00, Asia/Kolkata');
    // The next run is worded from its codes too, so no English shows; Chausar stays Chausar.
    expect(item.querySelector('[data-routine-line]')!.textContent).toMatch(/^अगला रन /);
    expect(item.querySelector('[data-asks]')!.textContent).toBe('Chausar से पूछता है');
  });
});
