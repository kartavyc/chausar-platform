import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient, type FakeOptions } from '../../src/engine/fake';
import { SAMPLE_MOVE_CODE } from '../../src/engine/fixtures';
import type { EngineClient, MoveFile } from '../../src/engine/types';
import { assertOnePrimaryPerView } from '../helpers/ink-rules';
import { keepPlan } from './first-run-steps';

/** One-shot B4 task 12: the first run, Welcome and the Start gallery, quiet. */
function start(options: FakeOptions = { fresh: true }) {
  window.location.hash = '#/today';
  const fake = createFakeClient(new FakeEngine(options));
  const client: EngineClient = { ...fake };
  render(<App client={client} language="en" />);
}
async function press(name: string | RegExp) { const button = await screen.findByRole('button', { name }, { timeout: 4000 }); await act(async () => { fireEvent.click(button); }); }
afterEach(() => { vi.restoreAllMocks(); });

describe('Connect your AI', () => {
  it('has no step line, no bottom box and no keychain chip before a key', async () => {
    start();
    await screen.findByRole('heading', { level: 1, name: 'Connect your AI' });
    await screen.findByText('Codex installed');
    expect(screen.queryByText('Step 1 of 3')).toBeNull();
    expect(screen.queryByText("Saved in this computer's keychain")).toBeNull();
    const limits = screen.getByText(/^Chausar sends your idea/);
    expect(limits.closest('[data-tile], [data-plain], [class*="tile"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Skip for now: use templates' }).getAttribute('data-variant')).toBe('quiet');
    assertOnePrimaryPerView();
  });

  it('a signed-in tool holds the fill, and opening the key form moves it there', async () => {
    const engine = new FakeEngine({ fresh: true });
    engine.firstRun.signIn();
    window.location.hash = '#/today';
    render(<App client={createFakeClient(engine)} language="en" />);
    const use = await screen.findByRole('button', { name: 'Use Codex' });
    expect(use.getAttribute('data-variant')).toBe('primary');
    await press('Add a key');
    expect(screen.getByRole('button', { name: 'Use Codex' }).getAttribute('data-variant')).toBe('secondary');
    expect(screen.getByRole('button', { name: 'Continue with this AI' }).getAttribute('data-variant')).toBe('primary');
  });
});

describe('About you', () => {
  async function atAbout() {
    start();
    await press('Skip for now: use templates');
    await screen.findByRole('heading', { level: 1, name: 'What work do you do?' });
  }

  it('shows six fields as a plain list with More fields, no Something else, and an attach with words', async () => {
    await atAbout();
    const list = await screen.findByRole('list', { name: 'Or pick your field' });
    expect(within(list).getAllByRole('button').length).toBe(6);
    expect(screen.getByText('More fields', { selector: 'summary *, summary' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Something else/ })).toBeNull();
    expect(screen.getByText('Add resume or LinkedIn file')).toBeTruthy();
    expect(screen.queryByText('Step 2 of 3')).toBeNull();
    assertOnePrimaryPerView();
  });

  it('has one way back on the plan card, and the field named once', async () => {
    await atAbout();
    await press(/^Money and tax/);
    await screen.findByRole('button', { name: 'Keep this plan' });
    expect(screen.getAllByRole('button').filter((b) => /^Back|^Open a business you/.test(b.textContent ?? '')).map((b) => b.textContent)).toEqual(['Back to fields']);
    const name = document.querySelector('[data-plan-name]') as HTMLElement;
    expect(name.parentElement!.querySelector('p')).toBeNull();
  });
});

describe('Connect what your business needs', () => {
  it('lists what works, says the rest in one line, and has one way on with no Skip per row', async () => {
    start();
    await keepPlan('Monthly bookkeeping for cafes and small shops in Pune.');
    await screen.findByRole('heading', { level: 1, name: 'Connect what your business needs' });
    const list = await screen.findByRole('list', { name: /^Services for/ });
    expect(within(list).queryByRole('button', { name: 'Skip' })).toBeNull();
    for (const row of within(list).getAllByRole('listitem')) expect(within(row).getByRole('button', { name: 'Set up' })).toBeTruthy();
    expect(screen.getByText(/^Coming soon: /)).toBeTruthy();
    expect(screen.queryByText('Step 3 of 3')).toBeNull();
    assertOnePrimaryPerView();
  });
});

describe('Welcome', () => {
  it('with no business: "Open a business", one filled button, and the other ways under one chooser', async () => {
    start();
    await press('Open a business you already have');
    await screen.findByRole('heading', { level: 1, name: 'Open a business' });
    const filled = [...document.querySelectorAll<HTMLElement>('main [data-variant="primary"]')];
    expect(filled.map((b) => b.textContent)).toEqual(['Move from another computer']);
    expect(screen.getByText('Bring a business here', { selector: 'summary *, summary' })).toBeTruthy();
    expect(screen.queryByText('More options')).toBeNull();
  });

  it('each business row says Open, and while a passphrase is asked Start and Move wait under More options', async () => {
    start({ closed: true });
    await screen.findByRole('heading', { level: 1, name: 'Welcome back' });
    const row = screen.getByRole('button', { name: /Sitara Events/ });
    expect(row.querySelector('[data-open-mark]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Start another business' })).toBeTruthy();
    await act(async () => { fireEvent.click(row); });
    const more = screen.getByText('More options', { selector: 'summary *, summary' }).closest('details')!;
    expect(within(more).getByRole('button', { name: 'Start another business', hidden: true })).toBeTruthy();
    expect(within(more).getByRole('button', { name: 'Move from another computer', hidden: true })).toBeTruthy();
  });

  it('the move code stays after a wrong try, with a placeholder for its form', async () => {
    const move = (await new FakeEngine().request('workspace.transfer.export', {})) as MoveFile;
    start({ closed: true });
    await screen.findByRole('heading', { level: 1, name: 'Welcome back' });
    await press('Move from another computer');
    const file = new File([move.text], 'x.chausar-move', { type: 'application/json' });
    await act(async () => { fireEvent.change(screen.getByLabelText('The move file'), { target: { files: [file] } }); });
    const code = screen.getByLabelText('The move code') as HTMLInputElement;
    expect(code.placeholder).toBe('CHT-XXXXXXXXXXXXXXXXXXXXXXXX');
    fireEvent.change(code, { target: { value: 'CHT-WRONG' } });
    await press('Move it here');
    await waitFor(() => expect(code.getAttribute('aria-invalid')).toBe('true'));
    expect(code.value).toBe('CHT-WRONG');
    expect(SAMPLE_MOVE_CODE).toBeTruthy();
  });
});

describe('the Start gallery', () => {
  it('says how starting works in one line, draws no icon or family tag on a card, and hides the chat prompts behind one link', async () => {
    window.location.hash = '#/onboarding';
    render(<App client={createFakeClient(new FakeEngine())} language="en" />);
    await screen.findByRole('list', { name: 'Ways to earn' }, { timeout: 4000 });
    expect(screen.queryByRole('region', { name: 'How starting works' })).toBeNull();
    expect(document.querySelectorAll('[data-how-line]').length).toBe(1);
    const card = document.querySelector('article[data-card]')!;
    expect(card.firstElementChild!.querySelector('[data-dept]')).toBeNull();
    expect(card.querySelector('[data-chip]')).toBeNull();
    expect(screen.getByRole('group', { name: /questions/i, hidden: true }).closest('details:not([open])')).not.toBeNull();
    expect(screen.getByText('Ask Chausar', { selector: 'summary *, summary' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Resume setup' })).toBeNull();
  });
});
