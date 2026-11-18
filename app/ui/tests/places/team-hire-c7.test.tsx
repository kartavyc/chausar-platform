import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { assertInkRules } from '../helpers/ink-rules';

/**
 * C7 task 16 (REPORT row 56): "Hire one more agent" opens the hire sheet, not onboarding. Each phase shows only its own
 * fields; a refused duty shows the stop's words beside the field; Hire adds the agent to the list; one primary per view.
 */
function start(client = createFakeClient(new FakeEngine())) {
  window.location.hash = '#/team';
  render(<App client={client} language="en" />);
}
const next = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next' })); }); };
const step = (name: string) => document.querySelector(`[data-hire-step="${name}"]`) as HTMLElement;

async function toRole(client?: ReturnType<typeof createFakeClient>) {
  start(client);
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Hire one more agent' })); window.dispatchEvent(new HashChangeEvent('hashchange')); });
  fireEvent.change(await screen.findByLabelText(/What do you want this agent to do\?/), { target: { value: 'someone who keeps my content calendar' } });
  await next();
  await waitFor(() => expect(step('role')).toBeTruthy());
}

describe('Team: Hire one more agent', () => {
  it('the button opens the sheet, not onboarding; each phase shows only its own fields; Hire adds the agent', async () => {
    await toRole();
    expect(window.location.hash).not.toContain('onboarding');
    expect(within(step('role')).getByLabelText('Name')).toBeTruthy();
    expect(screen.queryByText('What it reads')).toBeNull();
    await next();
    await waitFor(() => expect(step('reads')).toBeTruthy());
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(within(step('reads')).getByLabelText('Your plan')).toBeTruthy();
    await next();
    await waitFor(() => expect(step('voice')).toBeTruthy());
    await next();
    await waitFor(() => expect(step('review')).toBeTruthy());
    const review = step('review');
    expect(review.textContent).toContain('It asks you before anything leaves.');
    expect(document.querySelectorAll('[data-hire-step] [data-variant="primary"]')).toHaveLength(1);
    assertInkRules();
    await act(async () => { fireEvent.click(within(review).getByRole('button', { name: 'Hire' })); });
    expect(await screen.findByText('Mira is on your team now.')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('Mira').length).toBeGreaterThan(0));
  });

  it("a refused duty shows the stop's words beside the field, and stays on the step", async () => {
    await toRole();
    fireEvent.change(within(step('role')).getByLabelText(/Duties/), { target: { value: 'give stock tips to my clients' } });
    await next();
    const line = await screen.findByRole('alert');
    expect(line.textContent).toContain('No stock tips');
    expect(line.closest('[data-hire-step="role"]')).toBeTruthy();
  });

  // Found in the real app (16 Nov 2026): each Next took 8 to 10 s with no sign of work. While the owner's AI drafts the
  // next step the button is busy and one line says so; the review, which is code only, never says the AI is drafting.
  it('Next is busy and a line says the AI is drafting while a step is being drafted', async () => {
    const client = createFakeClient(new FakeEngine());
    const request = client.request.bind(client);
    let release: () => void = () => undefined;
    let held = false;
    client.request = (async (method: string, params: unknown) => {
      if (held && method === 'venture.agents.hire.answer') await new Promise<void>((resolve) => { release = resolve; });
      return request(method as never, params as never);
    }) as typeof client.request;
    await toRole(client);
    expect(screen.queryByText(/Your AI is drafting/)).toBeNull();
    held = true;
    await next();
    const button = screen.getByRole('button', { name: 'Next' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[data-hire-drafting]')?.textContent).toBe('Your AI is drafting this step. It can take a few seconds.');
    expect(document.querySelector('[data-hire-drafting]')?.getAttribute('role')).toBe('status');
    assertInkRules();
    await act(async () => { release(); });
    await waitFor(() => expect(step('reads')).toBeTruthy());
    expect(document.querySelector('[data-hire-drafting]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Next' }).getAttribute('aria-busy')).toBeNull();
    held = false;
    await next();
    await waitFor(() => expect(step('voice')).toBeTruthy());
    held = true;
    await next();
    expect(screen.getByRole('button', { name: 'Next' }).getAttribute('aria-busy')).toBe('true');
    expect(document.querySelector('[data-hire-drafting]')).toBeNull();
    await act(async () => { release(); });
    await waitFor(() => expect(step('review')).toBeTruthy());
  });

  // Found in the real app (17 Nov 2026): the review's "What it never does" was a closed fold, so it read as a heading
  // with nothing under it. Its list is open, like what it does and what it reads, and is the engine's own list: what this
  // agent never does by itself first, then every hard stop. What it reads is exactly the boxes ticked a step before.
  it('the review shows what it never does as an open list, and what it reads as the ticked boxes', async () => {
    await toRole();
    await next();
    await waitFor(() => expect(step('reads')).toBeTruthy());
    const ticked = within(step('reads')).getAllByRole('checkbox').filter((box) => (box as HTMLInputElement).checked).map((box) => box.closest('label')!.textContent!.trim());
    await next();
    await waitFor(() => expect(step('voice')).toBeTruthy());
    await next();
    await waitFor(() => expect(step('review')).toBeTruthy());
    const review = step('review');
    expect(review.querySelector('details')).toBeNull();
    const heading = within(review).getByRole('heading', { name: 'What it never does' });
    const never = [...(heading.nextElementSibling as HTMLElement).querySelectorAll('li')].map((item) => item.textContent);
    expect(never[0]).toBe('It never sends, pays, posts, deletes or changes a price by itself.');
    expect(never).toContain('No getting past a CAPTCHA. Chausar stops there.');
    expect(never).toHaveLength(10);
    const reads = [...(within(review).getByRole('heading', { name: 'What it reads' }).nextElementSibling as HTMLElement).querySelectorAll('li')].map((item) => item.textContent);
    expect(reads).toEqual(ticked);
  });
});
