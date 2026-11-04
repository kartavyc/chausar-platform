import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';

/**
 * W6 first run steps for tests written before it (6C1, 6C2, 6C6, 6C7): Connect your AI is skipped, About you keeps the
 * plan for the owner's sentence, the side-work question is answered, and the services step goes on to Today. The vault
 * steps the engine forces (a passphrase, the recovery code) sit between that answer and the services step.
 */
export const ABOUT_BOX = 'Tell Chausar about your work';

/**
 * A5: "Which of these are you?" follows Keep this plan; tests written before it keep the field ("None of these"), so
 * the rules step reads as it did. Pass a profession's own name to pick it instead.
 */
export async function confirmProfession(name = 'None of these') {
  const choice = await screen.findByRole('radio', { name }, { timeout: 4000 });
  await act(async () => { fireEvent.click(choice); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })); });
}

/** 6C6: the side-work question that follows Keep this plan (after A5's profession step), answered "I am not sure", then Continue. */
export async function answerSideWork() {
  await confirmProfession();
  const unsure = await screen.findByRole('radio', { name: 'I am not sure' }, { timeout: 4000 });
  await act(async () => { fireEvent.click(unsure); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })); });
}

export async function skipAi() {
  const skip = await screen.findByRole('button', { name: 'Skip for now: use templates' }, { timeout: 4000 });
  await act(async () => { fireEvent.click(skip); });
  return screen.findByRole('textbox', { name: ABOUT_BOX });
}

/** About you: the sentence, Send, then Keep this plan once the plan shows, then the side-work question. */
export async function keepPlan(text: string) {
  const box = screen.queryByRole('textbox', { name: ABOUT_BOX }) ?? await skipAi();
  fireEvent.change(box, { target: { value: text } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  const keep = await screen.findByRole('button', { name: 'Keep this plan' });
  await waitFor(() => expect(keep.hasAttribute('disabled')).toBe(false));
  await act(async () => { fireEvent.click(keep); });
  await answerSideWork();
}

/** The services step: skip them all by going on to Today. */
export async function toToday() {
  const go = await screen.findByRole('button', { name: 'Go to Today' }, { timeout: 4000 });
  await act(async () => { fireEvent.click(go); });
}
