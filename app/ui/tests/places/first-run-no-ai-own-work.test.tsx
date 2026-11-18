import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';
import { answerSideWork, skipAi, ABOUT_BOX, SIGN_IN_CHATGPT } from './first-run-steps';

/**
 * Without an AI, work outside the listed fields was a dead end (seen in the real app, 15 Nov 2026): "I could not tell
 * your field from that", and the closest field gave a template plan selling video edits. Now the reply says plainly
 * what is happening, the owner types what they sell (one to three offers, in their own words), the plan is kept with no
 * field, and a way back to step 1 keeps what they typed. No way to earn and no team show without an AI.
 */
const POTTER = 'I make pottery by hand, mostly mugs and bowls, and I want bulk orders from cafes and hotels in Pune.';
const OWN_REPLY = 'No AI is connected, so I could not place your work in my list of fields. Type what you sell on the right, or pick the closest field. With an AI connected, I can work it out with you.';

function start() {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) { return { ...original.call(this), timeZone: 'Asia/Kolkata' }; });
  window.location.hash = '#/today';
  const fake = createFakeClient(new FakeEngine({ fresh: true }));
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
async function send(text: string) {
  type(await skipAi(), text);
  await press('Send');
}

afterEach(() => { vi.restoreAllMocks(); });

describe('first run without an AI: work outside the listed fields', () => {
  it('says plainly what is happening, lets the owner type what they sell, and keeps the plan with no field', async () => {
    const { calls } = start();
    await send(POTTER);
    const chat = await screen.findByRole('region', { name: 'Talk to Chausar' });
    expect(await within(chat).findByText(OWN_REPLY)).toBeTruthy();
    expect(screen.queryByText('I could not tell your field from that. Write a little more, or pick your field on the right.')).toBeNull();
    // The card: no field, and the offers are boxes the owner types in. The first holds the one row taken from their words.
    expect((screen.getByRole('combobox', { name: 'Field' }) as HTMLSelectElement).value).toBe('');
    const first = await screen.findByRole('textbox', { name: 'Offer 1' }) as HTMLInputElement;
    expect(first.value).toBe('Pottery');
    expect(screen.getByText('Type one to three things you sell, in your own words.')).toBeTruthy();
    // Nothing a template or an AI wrote is on the card: no way to earn, no team, no template offer.
    expect(screen.queryByRole('region', { name: 'How you earn' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Your team' })).toBeNull();
    for (const template of ['Video edits', 'Design work', 'Monthly creative plan']) expect(screen.queryByText(template)).toBeNull();
    // The owner names what they sell: a name, an optional line, up to three.
    type(first, 'Cafe mug sets');
    type(screen.getByRole('textbox', { name: 'A line about offer 1' }), 'Hand thrown mugs in sets for cafes');
    await press('Add an offer');
    type(screen.getByRole('textbox', { name: 'Offer 2' }), 'Bowls');
    await press('Add an offer');
    type(screen.getByRole('textbox', { name: 'Offer 3' }), 'Custom orders');
    expect(screen.queryByRole('button', { name: 'Add an offer' })).toBeNull();
    await press('Remove offer 3');
    expect(screen.queryByRole('textbox', { name: 'Offer 3' })).toBeNull();
    const keep = await screen.findByRole('button', { name: 'Keep this plan' });
    await waitFor(() => expect(keep.hasAttribute('disabled')).toBe(false));
    await act(async () => { fireEvent.click(keep); });
    // No list of professions for work outside the fields: straight to the side-work question, under own-work.
    await answerSideWork();
    expect(await screen.findByRole('heading', { level: 1, name: 'Connect what your business needs' }, { timeout: 4000 })).toBeTruthy();
    expect(screen.queryByText('Which of these are you?')).toBeNull();
    expect(calls.find(([method]) => method === 'venture.compliance.get')?.[1]).toEqual({ profession: 'own-work' });
    expect(calls.find(([method]) => method === 'venture.create')?.[1]).toMatchObject({ idea: POTTER, countryCode: 'IN' });
    // The kept card: exactly what the owner typed, said to be the owner's.
    const draft = calls.find(([method]) => method === 'venture.blueprint.draft')![1] as { shown: { by: string; offers: unknown[] } };
    expect(draft.shown.by).toBe('owner');
    expect(draft.shown.offers).toEqual([{ name: 'Cafe mug sets', line: 'Hand thrown mugs in sets for cafes' }, { name: 'Bowls', line: '' }]);
    // No field, no way and no needs are written to the profile: there was no AI to propose them.
    expect(calls.filter(([method, params]) => method === 'venture.owner.set' && ('familyId' in params || 'way' in params || 'needs' in params))).toEqual([]);
    expect(calls.some(([method]) => method === 'venture.agents.hire.team')).toBe(false);
  });

  it('cannot be kept until one offer is named in plain words, and says why', async () => {
    start();
    await send('I want to help families plan weekend trips around Coorg.');
    const first = await screen.findByRole('textbox', { name: 'Offer 1' }) as HTMLInputElement;
    expect(first.value).toBe('');
    const keep = await screen.findByRole('button', { name: 'Keep this plan', description: 'Type at least one thing you sell.' });
    expect(keep.hasAttribute('disabled') || keep.getAttribute('aria-disabled') === 'true').toBe(true);
    // An amount is not an offer name: prices are set once the plan is kept.
    type(first, 'Trips at 5000');
    expect(await screen.findByText('Use words only, with no numbers or prices. You set prices once the plan is kept.')).toBeTruthy();
    expect(keep.hasAttribute('disabled') || keep.getAttribute('aria-disabled') === 'true').toBe(true);
    type(first, 'Weekend trip plans');
    await waitFor(() => expect(keep.hasAttribute('disabled') || keep.getAttribute('aria-disabled') === 'true').toBe(false));
    expect(screen.queryByText('Use words only, with no numbers or prices. You set prices once the plan is kept.')).toBeNull();
  });

  it('a follow-up message keeps what the owner typed on the card', async () => {
    const { calls } = start();
    await send(POTTER);
    type(await screen.findByRole('textbox', { name: 'Offer 1' }), 'Cafe mug sets');
    type(screen.getByRole('textbox', { name: 'Message Chausar' }), 'I can make about 200 pieces a month.');
    await act(async () => { fireEvent.submit(screen.getByRole('textbox', { name: 'Message Chausar' }).closest('form')!); });
    await waitFor(() => expect(calls.filter(([method]) => method === 'venture.about.read')).toHaveLength(2));
    const sent = calls.filter(([method]) => method === 'venture.about.read')[1]![1] as { before: { plan: { offers: unknown[] } } };
    expect(sent.before.plan.offers).toEqual([{ name: 'Cafe mug sets', line: '', kept: true, yours: true }]);
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Offer 1' }) as HTMLInputElement).value).toBe('Cafe mug sets'));
    expect(screen.queryByRole('textbox', { name: 'Offer 2' })).toBeNull();
  });

  it('the closest field can still be picked: what the owner typed stays as typed, and the field brings no examples', async () => {
    start();
    await send(POTTER);
    type(await screen.findByRole('textbox', { name: 'Offer 1' }), 'Cafe mug sets');
    await act(async () => { fireEvent.change(screen.getByRole('combobox', { name: 'Field' }), { target: { value: 'creative' } }); });
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'Field' }) as HTMLSelectElement).value).toBe('creative'));
    // Founder, 15 Nov 2026: a pick after the owner typed their offers only sets the field (first-run-round3.test.tsx).
    expect((screen.getByRole('textbox', { name: 'Offer 1' }) as HTMLInputElement).value).toBe('Cafe mug sets');
    expect(screen.queryByText('These are starting examples. Untick or rename any of them, or add your own.')).toBeNull();
    expect(screen.queryByText('Video edits')).toBeNull();
    // The owner can still add to it.
    await press('Add an offer');
    type(screen.getByRole('textbox', { name: 'Offer 2' }), 'Glaze design');
    expect((screen.getByRole('textbox', { name: 'Offer 2' }) as HTMLInputElement).value).toBe('Glaze design');
  });

  it('with nothing typed, the closest field brings its template offers as starting examples', async () => {
    start();
    await send(POTTER);
    await screen.findByRole('textbox', { name: 'Offer 1' });
    await act(async () => { fireEvent.change(screen.getByRole('combobox', { name: 'Field' }), { target: { value: 'creative' } }); });
    expect(await screen.findByText('These are starting examples. Untick or rename any of them, or add your own.')).toBeTruthy();
    const names = () => [...document.querySelectorAll('[data-offer-name]')].map((item) => item.textContent);
    await waitFor(() => expect(names()).toEqual(['Video edits', 'Design work', 'Monthly creative plan']));
    // Each template offer can be unticked and renamed.
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Video edits' })); });
    expect(screen.getByText('Video edits: removed.')).toBeTruthy();
    await press('Rename Design work');
    const edit = screen.getByRole('textbox', { name: 'Rename Design work' });
    type(edit, 'Glaze design');
    fireEvent.keyDown(edit, { key: 'Enter' });
    await waitFor(() => expect(names()).toEqual(['Glaze design', 'Monthly creative plan']));
  });

  it('a field picked from the tiles says its offers are starting examples', async () => {
    start();
    await skipAi();
    await press(/Creative work/);
    expect(await screen.findByText('These are starting examples. Untick or rename any of them, or add your own.')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Video edits' })).toBeTruthy();
  });

  it('Connect an AI goes back to step 1 and keeps what the owner typed', async () => {
    start();
    const box = await skipAi();
    type(screen.getByRole('textbox', { name: 'Your first name' }), 'Asha');
    type(box, POTTER);
    await press('Send');
    const chat = await screen.findByRole('region', { name: 'Talk to Chausar' });
    await within(chat).findByText(OWN_REPLY);
    await act(async () => { fireEvent.click(within(chat).getByRole('button', { name: 'Connect an AI' })); });
    // Step 1 again, with its sign-in.
    expect(await screen.findByRole('button', { name: SIGN_IN_CHATGPT }, { timeout: 4000 })).toBeTruthy();
    // Back to step 2 (here with no AI again): the words and the name are still there, and nothing was sent for them.
    const again = await skipAi() as HTMLTextAreaElement;
    expect(again.value).toBe(POTTER);
    expect((screen.getByRole('textbox', { name: 'Your first name' }) as HTMLInputElement).value).toBe('Asha');
    expect(screen.getByRole('textbox', { name: ABOUT_BOX })).toBeTruthy();
  });
});
