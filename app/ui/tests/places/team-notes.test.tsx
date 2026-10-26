import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type EngineClient } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

/*
 * The agent panel's Notes tab (Ink v2 wave 4, package 4B3; engine 4B2; catalogue A5): what an agent keeps from the
 * owner's words, each with its source and date; Edit keeps the owner's draft when the note changed since it was opened;
 * Forget asks once more in the engine's words (it erases, so it cannot be undone); every change has an Undo line.
 */

type FakeClient = ReturnType<typeof createFakeClient>;
type Intercept = (method: string, params: Record<string, unknown>, base: FakeClient) => Promise<unknown> | undefined;

function start(options: { intercept?: Intercept; language?: 'en' | 'hi' } = {}) {
  window.location.hash = '#/team?sheet=agent:editor&tab=notes';
  const base = createFakeClient(new FakeEngine());
  const spy = vi.fn();
  const client: EngineClient = {
    ...base,
    request: ((method: string, params?: Record<string, unknown>) => {
      spy(method, params);
      return options.intercept?.(method, params ?? {}, base) ?? base.request(method as never, params as never);
    }) as EngineClient['request'],
  };
  render(<App client={client} language={options.language ?? 'en'} />);
  return { spy };
}

const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const press = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element); }); await settle(); };
const calls = (spy: ReturnType<typeof vi.fn>, method: string) => spy.mock.calls.filter(([m]) => m === method).map(([, p]) => p as Record<string, unknown>);
const NOTE = 'Nimbus Mics wants every file as MP4, never MOV.';

async function notesOf() {
  const panel = await screen.findByRole('complementary', { name: 'Editor' });
  const list = await within(panel).findByRole('list', { name: 'Notes Editor keeps' });
  return { panel, list };
}

describe('The Notes tab', () => {
  it('lists each note with whom it is about, when it was saved and the owner words it came from', async () => {
    start();
    const { panel, list } = await notesOf();
    expect(within(panel).getByRole('tab', { name: 'Notes' }).getAttribute('aria-selected')).toBe('true');
    const note = within(list).getByText(NOTE).closest('li')!;
    expect(note.textContent).toContain('About Nimbus Mics · Saved 21 Oct');
    expect(note.textContent).toContain(`You said: 'Remember that ${NOTE}'`);
    expect(within(panel).getByText('0 of 2000 characters it reads on every order')).toBeTruthy();
    const changes = within(panel).getByRole('list', { name: 'Changes' });
    expect(within(changes).getByText('Saved from your words.')).toBeTruthy();
    assertInkRules(document.body);
  });

  it('adds a note, and its change line has Undo, which takes it away again', async () => {
    const { spy } = start();
    const { panel } = await notesOf();
    await press(within(panel).getByRole('button', { name: 'Add a note' }));
    await act(async () => { fireEvent.change(within(panel).getByRole('textbox', { name: 'New note' }), { target: { value: 'Shorts stay under a minute.' } }); });
    await press(within(panel).getByRole('button', { name: 'Save' }));
    expect(calls(spy, 'venture.agents.notes.edit')).toEqual([{ agent: 'editor', text: 'Shorts stay under a minute.' }]);
    const list = within(panel).getByRole('list', { name: 'Notes Editor keeps' });
    expect(within(list).getByText('Shorts stay under a minute.').closest('li')!.textContent).toContain('Read on every order');

    const changes = within(panel).getByRole('list', { name: 'Changes' });
    // Review 4B3: undoing a note's first change erases it, so it asks first with Forget's own words.
    await press(within(changes).getByRole('button', { name: 'Undo: You added a note.' }));
    expect(calls(spy, 'venture.agents.notes.undo')).toEqual([]);
    const ask = within(changes).getByRole('group', { name: 'Undo and erase this note?' });
    expect(ask.textContent).toContain("Forget erases these words. You can't undo it.");
    await press(within(ask).getByRole('button', { name: 'Undo and erase' }));
    expect(calls(spy, 'venture.agents.notes.undo')).toHaveLength(1);
    await waitFor(() => expect(within(panel).queryByText('Shorts stay under a minute.')).toBeNull());
    expect(within(within(panel).getByRole('list', { name: 'Changes' })).getByText('Undo took the note away. Its words are erased.')).toBeTruthy();
  });

  it('Edit sends the note as it was opened; a note that changed since keeps the owner draft with the engine words', async () => {
    const changed = 'This note changed since you opened it. Your draft is still here.';
    const { spy } = start({ intercept: (method) => (method === 'venture.agents.notes.edit' ? Promise.reject(new EngineError('NOTE_CHANGED', changed)) : undefined) });
    const { panel, list } = await notesOf();
    await press(within(within(list).getByText(NOTE).closest('li')!).getByRole('button', { name: 'Edit' }));
    const box = within(panel).getByRole('textbox', { name: 'Edit the note' }) as HTMLTextAreaElement;
    expect(box.value).toBe(NOTE);
    await act(async () => { fireEvent.change(box, { target: { value: 'Nimbus Mics wants MP4 files only.' } }); });
    await press(within(panel).getByRole('button', { name: 'Save' }));
    const sent = calls(spy, 'venture.agents.notes.edit')[0]!;
    expect(sent).toMatchObject({ agent: 'editor', noteId: 'note_seed1', text: 'Nimbus Mics wants MP4 files only.' });
    expect(sent.basedOn).toMatch(/^[a-f0-9]{64}$/);
    expect(within(panel).getByRole('alert').textContent).toBe(`${changed} Saving replaces the words above.`);
    expect((within(panel).getByRole('textbox', { name: 'Edit the note' }) as HTMLTextAreaElement).value).toBe('Nimbus Mics wants MP4 files only.');
  });

  it('Forget asks once more in the engine words, then forgets; a forgotten note has no Undo', async () => {
    const { spy } = start();
    const { panel, list } = await notesOf();
    await press(within(within(list).getByText(NOTE).closest('li')!).getByRole('button', { name: 'Forget' }));
    const ask = within(panel).getByRole('group', { name: 'Forget this note?' });
    expect(ask.textContent).toContain("Forget erases these words. You can't undo it.");
    expect(calls(spy, 'venture.agents.notes.forget')).toEqual([]);
    await press(within(ask).getByRole('button', { name: 'Forget it' }));
    expect(calls(spy, 'venture.agents.notes.forget')).toEqual([{ agent: 'editor', noteId: 'note_seed1' }]);
    await waitFor(() => expect(within(panel).getByText('No notes yet. Tell Editor in chat what to remember, or add one here.')).toBeTruthy());
    const changes = within(panel).getByRole('list', { name: 'Changes' });
    expect(within(changes).getByText(/^You forgot a note\. Its words are erased\./)).toBeTruthy();
    expect(within(changes).queryAllByRole('button', { name: /^Undo/ })).toEqual([]);
  });

  it('renders in Hindi with every key worded', async () => {
    start({ language: 'hi' });
    const panel = await screen.findByRole('complementary', { name: 'Editor' });
    await within(panel).findByRole('list', { name: 'Editor के नोट' });
    expect(within(panel).getByRole('tab', { name: 'नोट' })).toBeTruthy();
    const texts = [...panel.querySelectorAll('*')].flatMap((el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent!.trim()));
    expect(texts.filter((text) => /^team\.[a-z.]+$/i.test(text))).toEqual([]);
  });
});
