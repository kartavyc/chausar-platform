import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';
import { signInWith, skipAi, ABOUT_BOX } from './first-run-steps';

/**
 * 15 Nov 2026 (the first walk of the built Windows app, step 2): the owner picked their field in the Field list, sent
 * one more message, and the pick was gone: the list said "Or pick your field" again and Keep this plan was locked with
 * "Pick a field first". The answer to a follow-up carries the field the engine reads from the words (none without an AI
 * when no keyword fits, another one when a keyword does), and the page took it as it came. The owner's own pick now
 * holds through every later answer, with or without an AI, until they pick another field themselves; a new first
 * message starts over.
 */
const POTTER = 'I make pottery by hand, mostly mugs and bowls, and I want bulk orders from cafes and hotels in Pune.';

function start(engine = new FakeEngine({ fresh: true })) {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) { return { ...original.call(this), timeZone: 'Asia/Kolkata' }; });
  window.location.hash = '#/today';
  const fake = createFakeClient(engine);
  const calls: [string, Record<string, unknown>][] = [];
  const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => {
    calls.push([method, structuredClone(params ?? {})]);
    return fake.request(method as never, params as never);
  }) as EngineClient['request'] };
  render(<App client={client} language="en" />);
  return { calls };
}
const press = async (name: string | RegExp) => { await act(async () => { fireEvent.click(await screen.findByRole('button', { name })); }); };
const type = (box: HTMLElement, value: string) => { fireEvent.change(box, { target: { value } }); };
const field = () => screen.getByRole('combobox', { name: 'Field' }) as HTMLSelectElement;
const names = () => [...document.querySelectorAll('[data-offer-name]')].map((item) => item.textContent);
const reads = (calls: [string, Record<string, unknown>][]) => calls.filter(([method]) => method === 'venture.about.read');
async function say(calls: [string, Record<string, unknown>][], words: string) {
  const sent = reads(calls).length;
  type(screen.getByRole('textbox', { name: 'Message Chausar' }), words);
  await act(async () => { fireEvent.submit(screen.getByRole('textbox', { name: 'Message Chausar' }).closest('form')!); });
  await waitFor(() => expect(reads(calls)).toHaveLength(sent + 1));
  await act(async () => { await Promise.resolve(); });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('About you: the field the owner picked holds', () => {
  it('without an AI: another message keeps the picked field, its offers and Keep this plan', async () => {
    const { calls } = start();
    type(await skipAi(), POTTER);
    await press('Send');
    await screen.findByRole('textbox', { name: 'Offer 1' });
    expect(field().value).toBe('');
    await act(async () => { fireEvent.change(field(), { target: { value: 'creative' } }); });
    await waitFor(() => expect(names()).toContain('Video edits'));
    const before = names();
    expect((screen.getByRole('button', { name: 'Keep this plan' }) as HTMLButtonElement).getAttribute('aria-disabled')).not.toBe('true');

    await say(calls, 'I am a potter. I sell handmade ceramic products like mugs, plates and bowls.');
    expect(field().value).toBe('creative');
    expect(names()).toEqual(before);
    expect(screen.queryByText('Pick a field first')).toBeNull();
    expect((screen.getByRole('button', { name: 'Keep this plan' }) as HTMLButtonElement).getAttribute('aria-disabled')).not.toBe('true');
    // The card is the picked field's plan, not boxes to type in, and the chat says where the plan comes from.
    expect(screen.queryByRole('textbox', { name: 'Offer 1' })).toBeNull();
    const chat = screen.getByRole('region', { name: 'Talk to Chausar' });
    expect(within(chat).getByText('No AI is connected, so this plan comes from templates for Creative work.')).toBeTruthy();
    // The next message carries the picked field as the plan's, so it holds turn after turn.
    await say(calls, 'Most of my buyers are cafes.');
    expect((reads(calls).at(-1)![1] as { before: { plan: { familyId: string } } }).before.plan.familyId).toBe('creative');
    expect(field().value).toBe('creative');

    // Until the owner changes it: another pick is theirs too, and it holds the same way.
    await act(async () => { fireEvent.change(field(), { target: { value: 'local-services' } }); });
    await waitFor(() => expect(field().value).toBe('local-services'));
    await say(calls, 'I also sell at weekend markets.');
    expect(field().value).toBe('local-services');
  }, 20000);

  it('with an AI: words that read as another field do not move the field the owner picked', async () => {
    const engine = new FakeEngine({ fresh: true });
    engine.firstRun.signIn();
    const { calls } = start(engine);
    await signInWith();
    type(await screen.findByRole('textbox', { name: ABOUT_BOX }), 'I am a freelance accountant and I file GST returns for small shops.');
    await press('Send');
    await waitFor(() => expect(field().value).toBe('money-tax'));
    await act(async () => { fireEvent.change(field(), { target: { value: 'local-services' } }); });
    await waitFor(() => expect(field().value).toBe('local-services'));
    // "GST returns" reads as Money and tax again; the owner said Local services.
    await say(calls, 'I also file GST returns for two clinics.');
    expect(field().value).toBe('local-services');
    expect(screen.queryByText('Pick a field first')).toBeNull();
  }, 20000);

  it('a new first message starts over: the field is read from the new words', async () => {
    const { calls } = start();
    type(await skipAi(), POTTER);
    await press('Send');
    await screen.findByRole('textbox', { name: 'Offer 1' });
    await act(async () => { fireEvent.change(field(), { target: { value: 'creative' } }); });
    await waitFor(() => expect(field().value).toBe('creative'));
    await press('Back to fields');
    type(await screen.findByRole('textbox', { name: ABOUT_BOX }), 'I am a freelance accountant and I file GST returns for small shops.');
    await press('Send');
    await waitFor(() => expect(reads(calls)).toHaveLength(2));
    await waitFor(() => expect(field().value).toBe('money-tax'));
  }, 20000);
});
