import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';

/**
 * One-shot A5 (founder answer 3a; checklist "onboarding never shows a profession's rules"): the AI's read picks the
 * owner's exact profession and the owner confirms it in "Which of these are you?", from the AI's pick and the field's
 * other professions. The rules step then gets the profession, so its own rules (Bar Council, FSSAI) and the size
 * question show. A tile (no AI) picks nothing, and the owner chooses. "None of these" keeps the field, as before.
 */
const BOX = 'Tell Chausar about your work';
const ADVOCATE = 'I am an advocate in Pune and want to help small firms with contracts and notices.';

function timeZone(zone: string) {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...original.call(this), timeZone: zone };
  });
}
async function start({ ai = false } = {}) {
  window.location.hash = '#/today';
  const engine = new FakeEngine({ fresh: true });
  const fake = createFakeClient(engine);
  if (ai) {
    const options = await fake.request('venture.ai.options', {});
    const preset = options.presets.find((row) => row.id === 'claude-code-cli')!;
    await fake.request('venture.ai.connect', { presetId: preset.id, consentDigest: preset.consentDigest });
  }
  const calls: [string, Record<string, unknown>][] = [];
  const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => { calls.push([method, structuredClone(params ?? {})]); return fake.request(method as never, params as never); }) as EngineClient['request'] };
  render(<App client={client} language="en" />);
  return { calls };
}
async function press(name: string | RegExp) { const button = await screen.findByRole('button', { name }, { timeout: 4000 }); await act(async () => { fireEvent.click(button); }); }
async function who() { return screen.findByRole('group', { name: 'Which of these are you?' }, { timeout: 4000 }); }
const radios = (group: HTMLElement) => within(group).getAllByRole('radio') as HTMLInputElement[];
const labelOf = (radio: HTMLInputElement) => [...(radio.closest('label')?.querySelectorAll('span') ?? [])].map((part) => part.textContent).join(' ');

afterEach(() => { vi.restoreAllMocks(); });

describe('first run: "Which of these are you?" (A5)', () => {
  it('lists the AI\'s pick first and chosen, then the field\'s other professions, and the rules step gets the profession', async () => {
    timeZone('Asia/Kolkata');
    const { calls } = await start({ ai: true });
    await press('Skip for now: use templates');
    fireEvent.change(await screen.findByRole('textbox', { name: BOX }), { target: { value: ADVOCATE } });
    await press('Send');
    await press('Keep this plan');
    expect(screen.getByRole('heading', { level: 1, name: 'Which of these are you?' })).toBeTruthy();
    const group = await who();
    const listed = radios(group);
    expect(listed.map(labelOf)).toEqual(['Advocate From what you wrote', 'Doctor', 'Financial planner or MFD', 'None of these']);
    expect(listed[0]!.checked).toBe(true);
    // Nothing is asked about rules yet, and nothing is kept.
    expect(calls.some(([method]) => method === 'venture.compliance.get')).toBe(false);
    await act(async () => { fireEvent.click(within(group).getByRole('button', { name: 'Continue' })); });
    const check = await screen.findByRole('region', { name: 'Day job and rules' }, { timeout: 4000 });
    expect(calls.find(([method]) => method === 'venture.compliance.get')?.[1]).toEqual({ profession: 'advocate' });
    expect(check.getAttribute('data-compliance')).toBe('advocate');
    expect(check.querySelector('[data-profession-rule="bci-rule-36"]')).toBeTruthy();
    expect(within(check).getByText('Outreach is off: Bar Council rules bar advocates from asking people for work.')).toBeTruthy();
    await act(async () => { fireEvent.click(within(check).getByRole('radio', { name: 'I am not sure' })); });
    await act(async () => { fireEvent.click(within(check).getByRole('button', { name: 'Continue' })); });
    expect(await screen.findByRole('heading', { level: 1, name: 'Connect what your business needs' }, { timeout: 4000 })).toBeTruthy();
    const set = calls.find(([method]) => method === 'venture.compliance.set');
    expect(set?.[1]).toMatchObject({ profession: 'advocate', sideWork: 'not-sure' });
  }, 20000);

  it('after a tile nothing is chosen: Continue waits for a pick, and a home chef sees FSSAI and the size question', async () => {
    timeZone('Asia/Kolkata');
    const { calls } = await start();
    await press('Skip for now: use templates');
    await press(/^Local services/);
    await press('Keep this plan');
    const group = await who();
    const listed = radios(group);
    expect(listed.map(labelOf)).toEqual(['Beautician or salon', 'Electrician, plumber or AC technician', 'Home chef or tiffin', 'Real estate broker', 'Travel agent', 'Event or wedding planner', 'Physiotherapist', 'None of these']);
    expect(listed.some((radio) => radio.checked)).toBe(false);
    const go = within(group).getByRole('button', { name: 'Continue' });
    expect(go.getAttribute('aria-disabled')).toBe('true');
    expect(within(group).getByText('Pick one first.')).toBeTruthy();
    await act(async () => { fireEvent.click(go); });
    expect(calls.some(([method]) => method === 'venture.compliance.get')).toBe(false);
    await act(async () => { fireEvent.click(within(group).getByRole('radio', { name: 'Home chef or tiffin' })); });
    await act(async () => { fireEvent.click(within(group).getByRole('button', { name: 'Continue' })); });
    const check = await screen.findByRole('region', { name: 'Day job and rules' }, { timeout: 4000 });
    expect(calls.find(([method]) => method === 'venture.compliance.get')?.[1]).toEqual({ profession: 'home-chef-tiffin' });
    expect(check.querySelector('[data-profession-rule="fssai"]')).toBeTruthy();
    expect(within(check).getByRole('radiogroup', { name: "What's your yearly turnover?" })).toBeTruthy();
  }, 20000);

  it('"None of these" keeps the field, so the rules step shows the field as it did before', async () => {
    timeZone('Asia/Kolkata');
    const { calls } = await start();
    await press('Skip for now: use templates');
    await press(/^Teaching and coaching/);
    await press('Keep this plan');
    const group = await who();
    await act(async () => { fireEvent.click(within(group).getByRole('radio', { name: 'None of these' })); });
    await act(async () => { fireEvent.click(within(group).getByRole('button', { name: 'Continue' })); });
    await screen.findByRole('region', { name: 'Day job and rules' }, { timeout: 4000 });
    await waitFor(() => expect(calls.find(([method]) => method === 'venture.compliance.get')?.[1]).toEqual({ profession: 'teaching' }));
  }, 20000);
});
