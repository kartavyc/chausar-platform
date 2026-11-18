import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect } from 'vitest';

/**
 * W6 first run steps for tests written before it (6C1, 6C2, 6C6, 6C7): Connect your AI is skipped, About you keeps the
 * plan for the owner's sentence, the side-work question is answered, and the services step goes on to Today. The vault
 * steps the engine forces (a passphrase, the recovery code) sit between that answer and the services step.
 */
export const ABOUT_BOX = 'Tell Chausar about your work';
/** Step 1's two sign-in buttons and its way on with no AI (under More options). */
export const SIGN_IN_CHATGPT = 'Sign in with ChatGPT';
export const SIGN_IN_CLAUDE = 'Sign in with Claude';
export const NO_AI = 'Continue without AI for now';

/**
 * A5: "Which of these are you?" follows Keep this plan; tests written before it keep the field ("None of these"), so
 * the rules step reads as it did. Pass a profession's own name to pick it instead.
 */
export async function confirmProfession(name = 'None of these') {
  // The question is not asked when the AI read work that fits none of its field's professions (the engine's ownKind):
  // then the rules step is already on screen, reading the field as "None of these" does.
  const choice = await waitFor(() => {
    const radio = screen.queryByRole('radio', { name });
    if (!radio && !screen.queryByRole('region', { name: 'Day job and rules' })) throw new Error('Neither the profession question nor the rules step is on screen.');
    return radio;
  }, { timeout: 4000 });
  if (!choice) return;
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

/** Step 1's other ways on sit behind a closed "More options": this opens it, as an owner does, and returns the fold. */
export async function openMoreOptions() {
  const summary = await screen.findByText('More options', { selector: 'summary' }, { timeout: 4000 });
  const fold = summary.closest('details')!;
  if (!fold.open) await act(async () => { fireEvent.click(summary); });
  return fold;
}

/** Step 1's sign-in: the button waits for the first look at this computer, so this presses it once it can be pressed. */
export async function signInWith(name: string = SIGN_IN_CHATGPT) {
  const button = await screen.findByRole('button', { name }, { timeout: 4000 });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false), { timeout: 4000 });
  await act(async () => { fireEvent.click(button); });
}

/** Step 1 with no AI: More options, then "Continue without AI for now". Returns the About you box that follows. */
export async function skipAi() {
  const fold = await openMoreOptions();
  await act(async () => { fireEvent.click(within(fold).getByRole('button', { name: NO_AI })); });
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
