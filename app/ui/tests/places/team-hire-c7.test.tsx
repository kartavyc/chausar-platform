import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { assertInkRules } from '../helpers/ink-rules';

/**
 * C7 task 16 (REPORT row 56): "Hire one more agent" opens the hire sheet, not onboarding. Each phase shows only its own
 * fields; a refused duty shows the stop's words beside the field; Hire adds the agent to the list; one primary per view.
 */
function start() {
  window.location.hash = '#/team';
  render(<App client={createFakeClient(new FakeEngine())} language="en" />);
}
const next = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next' })); }); };
const step = (name: string) => document.querySelector(`[data-hire-step="${name}"]`) as HTMLElement;

async function toRole() {
  start();
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
});
