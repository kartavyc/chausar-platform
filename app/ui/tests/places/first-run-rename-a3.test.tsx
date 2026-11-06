import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';
import { renameIn } from '../../src/places/onboarding/rename';
import { answerSideWork, toToday } from './first-run-steps';

/*
 * One-shot A3 (S1): the plan the owner saw is the plan that is saved. In the hands-on test "Please call the business
 * Pune Frames Studio." went to the AI again, which never names a business, so the card kept the field's name and the
 * reply did not change. A rename in the About you chat is now read by code: the card's name changes at once, the chat
 * says so, no AI call is made, and Keep this plan saves that name with the card's offers. The plan page and Today then
 * show the same name and offers.
 */

const READ = {
  family: { id: 'creative', label: 'Creative work', line: 'Design, photos, video and writing.' },
  offers: [
    { name: 'Birthday party photography', line: 'Candid photos of the party, edited and shared.' },
    { name: 'Shop product photos', line: 'Clean photos of what a shop sells.' },
    { name: 'Monthly photo support', line: 'A set of photos each month for a shop.' },
  ],
  country: null, evidence: null, idea: 'Photography for parties and shops in Pune', source: 'ai' as const,
};

function timeZone(zone: string) {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...original.call(this), timeZone: zone };
  });
}
async function press(name: string | RegExp) { const button = await screen.findByRole('button', { name }, { timeout: 4000 }); await act(async () => { fireEvent.click(button); }); }

afterEach(() => { vi.restoreAllMocks(); });

describe('a rename by code (A3, S1)', () => {
  it('reads "call it" and "name the business" requests, and nothing else', () => {
    expect(renameIn('Please call the business Pune Frames Studio.')).toEqual({ name: 'Pune Frames Studio', rest: '' });
    expect(renameIn('call it "Lens & Light"')).toEqual({ name: 'Lens & Light', rest: '' });
    expect(renameIn('Name it Asha Rao Photography')).toEqual({ name: 'Asha Rao Photography', rest: '' });
    expect(renameIn('Can you rename the business to Frame Works?')).toEqual({ name: 'Frame Works', rest: '' });
    expect(renameIn('Change the name to Pune Frames')).toEqual({ name: 'Pune Frames', rest: '' });
    expect(renameIn('call it something nicer')).toBeNull();
    expect(renameIn('I also do weddings, call me for those')).toBeNull();
    expect(renameIn('Please add wedding shoots.')).toBeNull();
    expect(renameIn(`Call it ${'A'.repeat(70)}`)).toBeNull();
  });

  it('A3 review L2: the name stops at a comma, "and", "but" or "instead", and the rest still goes to the AI', () => {
    expect(renameIn('Call it Pune Frames, and add wedding shoots too')).toEqual({ name: 'Pune Frames', rest: 'add wedding shoots too' });
    expect(renameIn('Rename it to Pune Frames but keep the offers')).toEqual({ name: 'Pune Frames', rest: 'keep the offers' });
    expect(renameIn('Could you call it Saturday instead?')).toEqual({ name: 'Saturday', rest: '' });
    expect(renameIn("Call it I don't know yet")).toBeNull();
    expect(renameIn('Call it My Lovely Little Weekend Photo Studio')).toBeNull();
    expect(renameIn('Call it We Shoot Parties')).toBeNull();
  });

  it('A3 review 2 L-d: "and" or "but" inside a name, and a full stop after Mr or an initial, stay in the name', () => {
    expect(renameIn('Call it Bread and Butter Bakery')).toEqual({ name: 'Bread and Butter Bakery', rest: '' });
    expect(renameIn('Call it Salt but Sweet')).toEqual({ name: 'Salt but Sweet', rest: '' });
    expect(renameIn('Call it Mr. Frames')).toEqual({ name: 'Mr. Frames', rest: '' });
    expect(renameIn('Call it Dr. Rao Clinic.')).toEqual({ name: 'Dr. Rao Clinic', rest: '' });
    expect(renameIn('Call it A. R. Photos')).toEqual({ name: 'A. R. Photos', rest: '' });
    expect(renameIn('Call it Bread and Butter and also add cake orders')).toEqual({ name: 'Bread and Butter', rest: 'also add cake orders' });
    expect(renameIn('Call it Pune Frames and include wedding shoots')).toEqual({ name: 'Pune Frames', rest: 'include wedding shoots' });
  });
});

describe('first run: the name the owner asked for is the name kept (A3, S1)', () => {
  it('renames the card without an AI call, says so, and keeps that name and the card\'s offers on the plan page and Today', async () => {
    timeZone('Asia/Kolkata');
    const fake = createFakeClient(new FakeEngine({ fresh: true }));
    const reads: unknown[] = [];
    const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => {
      if (method === 'venture.about.read') { reads.push(params); return Promise.resolve(structuredClone(READ)); }
      return fake.request(method as never, params as never);
    }) as EngineClient['request'] };
    window.location.hash = '#/today';
    render(<App client={client} language="en" />);
    await press('Skip for now: use templates');
    fireEvent.change(await screen.findByRole('textbox', { name: 'Tell Chausar about your work' }), { target: { value: 'I run a small weekend photography studio in Pune.' } });
    await press('Send');
    expect(await screen.findByText('Birthday party photography')).toBeTruthy();
    expect(reads).toHaveLength(1);

    fireEvent.change(screen.getByRole('textbox', { name: 'Message Chausar' }), { target: { value: 'Please call the business Pune Frames Studio.' } });
    await act(async () => { fireEvent.submit(screen.getByRole('textbox', { name: 'Message Chausar' }).closest('form')!); });
    expect(await screen.findByText('Renamed it to Pune Frames Studio.')).toBeTruthy();
    expect(reads).toHaveLength(1);
    const card = document.querySelector<HTMLInputElement>('[data-plan-name]')!;
    expect(card.value).toBe('Pune Frames Studio');
    expect(screen.getByText('Shop product photos')).toBeTruthy();

    const keep = await screen.findByRole('button', { name: 'Keep this plan' });
    await waitFor(() => expect(keep.hasAttribute('disabled')).toBe(false));
    await act(async () => { fireEvent.click(keep); });
    await answerSideWork();
    expect(await screen.findByRole('heading', { level: 1, name: 'Connect what your business needs' }, { timeout: 4000 })).toBeTruthy();

    const plan = (await fake.request('venture.blueprint.get', {}))!;
    expect(plan.blueprint.name.value).toBe('Pune Frames Studio');
    expect(plan.blueprint.offers.map((offer) => offer.name.value)).toEqual(READ.offers.map((offer) => offer.name));
    expect((await fake.request('venture.get', {}))?.venture?.workingName).toBe('Pune Frames Studio');

    // Today: the kept plan waits for the owner first.
    await toToday();
    const today = await screen.findByRole('main');
    await waitFor(() => expect(within(today).getAllByText('Your plan is ready. Read it.').length).toBeGreaterThan(0));
    // The plan page: the same name and the card's offers.
    await act(async () => { window.location.hash = '#/business/plan'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    const heading = await screen.findByRole('heading', { level: 2, name: /Pune Frames Studio/ }, { timeout: 4000 });
    expect(heading).toBeTruthy();
    for (const offer of READ.offers) expect(await screen.findByText(offer.name)).toBeTruthy();
  });
});

describe('a rename with more asked after it (A3 review, L2)', () => {
  it('renames by code and sends only the rest to the AI', async () => {
    timeZone('Asia/Kolkata');
    const fake = createFakeClient(new FakeEngine({ fresh: true }));
    const reads: { text?: string }[] = [];
    const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => {
      if (method === 'venture.about.read') { reads.push(params as { text?: string }); return Promise.resolve(structuredClone(READ)); }
      return fake.request(method as never, params as never);
    }) as EngineClient['request'] };
    window.location.hash = '#/today';
    render(<App client={client} language="en" />);
    await press('Skip for now: use templates');
    fireEvent.change(await screen.findByRole('textbox', { name: 'Tell Chausar about your work' }), { target: { value: 'I run a small weekend photography studio in Pune.' } });
    await press('Send');
    expect(await screen.findByText('Birthday party photography')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Message Chausar' }), { target: { value: 'Call it Pune Frames, and add wedding shoots too' } });
    await act(async () => { fireEvent.submit(screen.getByRole('textbox', { name: 'Message Chausar' }).closest('form')!); });
    expect(await screen.findByText('Renamed it to Pune Frames.')).toBeTruthy();
    await waitFor(() => expect(reads).toHaveLength(2));
    expect(reads[1]!.text).toContain('add wedding shoots too');
    expect(reads[1]!.text).not.toContain('Call it');
    await waitFor(() => expect(document.querySelector<HTMLInputElement>('[data-plan-name]')!.value).toBe('Pune Frames'));
  });
});
