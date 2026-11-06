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

function start(intercept: Partial<Record<MethodName, (params: unknown) => unknown>> = {}, language: 'en' = 'en') {
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
    const nav = screen.getByRole('navigation', { name: 'Settings' });
    expect(within(nav).getByRole('link', { name: 'Routines' }).getAttribute('aria-current')).toBe('page');
    const item = await screen.findByRole('article', { name: 'Weekly review' });
    expect(item.querySelector('[data-when]')!.textContent).toBe('Every Monday 9:00 am, Asia/Kolkata');
    expect(item.querySelector('[data-asks]')!.textContent).toBe('Asks Chausar');
    // Worded by the screen from routine.on and routine.next, in the routine's own time zone.
    expect(item.querySelector('[data-routine-line]')!.textContent).toBe('Next time 26 Oct, 9:00 am');
    assertInkRules();
  });

  it('its history says Delivered for a finished run, never Done, with the engine line', async () => {
    start();
    const item = await screen.findByRole('article', { name: 'Weekly review' });
    const fold = item.querySelector('details[data-fold="history"]') as HTMLDetailsElement;
    await act(async () => { fold.open = true; fold.dispatchEvent(new Event('toggle')); });
    await waitFor(() => expect(fold.querySelectorAll('li')).toHaveLength(2));
    const lines = [...fold.querySelectorAll('li')].map((li) => li.textContent);
    // W6 6G5: a delivered run that asked the AI carries its model receipt under the line.
    expect(lines[0]).toMatch(/^Delivered, 20 Oct 2026Model receipt/);
    expect(lines[0]).toContain('On your plan');
    expect(lines[1]).toMatch(/^Missed: Missed once while Chausar was closed\./);
    expect(fold.textContent).not.toMatch(/\bDone\b/);
  });

  it('adds a routine on weekdays at a time in a time zone, on one press', async () => {
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
    expect(form.querySelector('[data-second-ask]')).toBeNull();
    const set = calls.find((c) => c.method === 'venture.routines.set')!;
    expect(set.params).toEqual({ routine: {
      name: 'Morning check', agent: null, prompt: 'List the invoices that fell due this week and who has not paid.', on: true,
      schedule: { kind: 'calendar', weekdays: [1, 3], time: '08:30', timeZone: 'Asia/Kolkata' },
    } });
    const added = await screen.findByRole('article', { name: 'Morning check' });
    expect(added.querySelector('[data-when]')!.textContent).toBe('Every Monday and Wednesday 8:30 am, Asia/Kolkata');
  });

  it('C4 task 32: with no routines, the ready ones from the plan each have Add, which fills the form; the owner still saves', async () => {
    const monthly = { name: 'Draft the monthly report for review', agent: null, prompt: 'Draft the monthly report for review for this business, from its own records and plan. Keep it as a draft for my approval.', schedule: { kind: 'monthly', day: 1, time: '09:00', timeZone: 'Asia/Kolkata' }, when: 'On the 1st of each month, 9:00 am, Asia/Kolkata', step: 'Draft the monthly report for review' };
    const weekly = { name: 'Send the weekly summary', agent: null, prompt: 'Send the weekly summary for this business, from its own records and plan. Keep it as a draft for my approval.', schedule: { kind: 'calendar', weekdays: [1], time: '09:00', timeZone: 'Asia/Kolkata' }, when: 'Every Monday 9:00 am, Asia/Kolkata', step: 'Send the weekly summary' };
    const { calls } = start({ 'venture.routines.list': () => ({ routines: [] }), 'venture.routines.suggestions': () => ({ suggestions: [monthly, weekly] }) });
    const ready = await screen.findByRole('list', { name: 'Ready from your plan' });
    const items = within(ready).getAllByRole('listitem');
    expect(items.map((item) => item.querySelector('[data-suggestion-name]')!.textContent)).toEqual([monthly.name, weekly.name]);
    expect(items[0]!.textContent).toContain('On the 1st of each month, 9:00 am, Asia/Kolkata');
    await press(items[0]!, 'Add');
    const form = screen.getByRole('form', { name: 'Add a routine' });
    expect((form.closest('details') as HTMLDetailsElement).open).toBe(true);
    expect((within(form).getByLabelText('Name') as HTMLInputElement).value).toBe(monthly.name);
    expect((within(form).getByLabelText('What to ask') as HTMLTextAreaElement).value).toBe(monthly.prompt);
    expect(form.textContent).toContain('On the 1st of each month, 9:00 am, Asia/Kolkata');
    expect(calls.some((c) => c.method === 'venture.routines.set')).toBe(false);
    await press(form, 'Save routine');
    const set = calls.find((c) => c.method === 'venture.routines.set')!;
    expect(set.params).toEqual({ routine: { name: monthly.name, agent: null, prompt: monthly.prompt, on: true, schedule: monthly.schedule } });
    // A weekly one fills the days, the time and the zone.
    await press(items[1]!, 'Add');
    const again = screen.getByRole('form', { name: 'Add a routine' });
    await waitFor(() => expect((within(again).getByLabelText('Name') as HTMLInputElement).value).toBe(weekly.name));
    expect((within(again).getByRole('checkbox', { name: 'Monday' }) as HTMLInputElement).checked).toBe(true);
    expect((within(again).getByRole('checkbox', { name: 'Tuesday' }) as HTMLInputElement).checked).toBe(false);
  });

  it('C4 task 32: no ready routines, no list', async () => {
    start({ 'venture.routines.suggestions': () => ({ suggestions: [] }), 'venture.routines.list': () => ({ routines: [] }) });
    await screen.findByText('No routines yet.');
    expect(screen.queryByRole('list', { name: 'Ready from your plan' })).toBeNull();
  });

  it('a prompt that leans on the chat is refused in the engine words', async () => {
    start({ 'venture.routines.set': () => { throw new EngineError('ROUTINE_NOT_STANDALONE', 'A routine runs without the chat, so "like before" would point at nothing. Say in full what you want each time.'); } });
    await screen.findByRole('article', { name: 'Weekly review' });
    const form = screen.getByRole('form', { name: 'Add a routine' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Again' } });
    fireEvent.change(within(form).getByLabelText('What to ask'), { target: { value: 'Do the report like before, please.' } });
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Friday' }));
    await press(form, 'Save routine');
    await waitFor(() => expect(within(form).getByRole('alert').textContent).toBe("Couldn't save it: A routine runs without the chat, so \"like before\" would point at nothing. Say in full what you want each time."));
  });

  it('"check your AI first" carries Check now: it runs the check, says Checking..., and saves what was asked (B4)', async () => {
    let checked = false;
    let finish: () => void = () => {};
    const { calls } = start({
      'venture.routines.set': (params) => {
        if (!checked) throw new EngineError('ROUTINE_NEEDS_CHECK', 'Run Check connections once before a routine uses this connection, so Chausar knows it works.');
        return { routine: { ...(params as { routine: object }).routine, id: 'routine-new', when: '', next: null } };
      },
      'venture.connectors.check': () => new Promise((resolve) => { finish = () => { checked = true; resolve({ at: '2026-10-23T10:00:00.000Z', rows: [] }); }; }),
    });
    await screen.findByRole('article', { name: 'Weekly review' });
    const form = screen.getByRole('form', { name: 'Add a routine' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Again' } });
    fireEvent.change(within(form).getByLabelText('What to ask'), { target: { value: 'Write the report in full.' } });
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Friday' }));
    await press(form, 'Save routine');
    await within(form).findByText(/^Couldn't save it: Run Check connections once/);
    // A known state, not an alarm.
    expect(within(form).queryByRole('alert')).toBeNull();
    await press(form, 'Check now');
    // The line clears on the press and says what is happening.
    expect(within(form).queryByText(/^Couldn't save it/)).toBeNull();
    expect(within(form).getByText('Checking...')).toBeTruthy();
    expect(calls.some((c) => c.method === 'venture.connectors.check')).toBe(true);
    await act(async () => { finish(); });
    await waitFor(() => expect(calls.filter((c) => c.method === 'venture.routines.set')).toHaveLength(2));
    expect(within(form).queryByText('Checking...')).toBeNull();
    expect(within(form).queryByRole('button', { name: 'Check now' })).toBeNull();
  });

  it('a check that fails says so in the same slot, and saves nothing more (B4)', async () => {
    const { calls } = start({
      'venture.routines.set': () => { throw new EngineError('ROUTINE_NEEDS_CHECK', 'Run Check connections once before a routine uses this connection, so Chausar knows it works.'); },
      'venture.connectors.check': () => { throw new EngineError('CHECK_FAILED', 'The check did not run.'); },
    });
    await screen.findByRole('article', { name: 'Weekly review' });
    const form = screen.getByRole('form', { name: 'Add a routine' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Again' } });
    fireEvent.change(within(form).getByLabelText('What to ask'), { target: { value: 'Write the report in full.' } });
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Friday' }));
    await press(form, 'Save routine');
    await press(form, 'Check now');
    await waitFor(() => expect(within(form).getByRole('alert').textContent).toContain('The check did not run.'));
    expect(calls.filter((c) => c.method === 'venture.routines.set')).toHaveLength(1);
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
    expect((off.querySelector('[data-second-ask]') as HTMLElement).textContent).toContain('Turn it on? Each job waits for your approval on Today.');
    await press(off.querySelector('[data-second-ask]') as HTMLElement, 'Turn on');
    await waitFor(() => expect(screen.getByRole('article', { name: 'Weekly review' }).querySelector('[data-routine-line]')!.textContent).toMatch(/^Next time /));
  });

  it('changes a routine in its own form, prefilled, on one press', async () => {
    const { calls } = start();
    const item = await screen.findByRole('article', { name: 'Weekly review' });
    await press(item, 'Change');
    const form = within(item).getByRole('form', { name: 'Change Weekly review' });
    expect((within(form).getByLabelText('What to ask') as HTMLTextAreaElement).value).toMatch(/^Give me a weekly review/);
    expect((within(form).getByRole('checkbox', { name: 'Monday' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Monday review' } });
    await press(form, 'Save routine');
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


});
