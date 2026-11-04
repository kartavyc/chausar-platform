// One-shot A5 (founder answer 3a): the profession confirmed in onboarding can be changed later in Business > About you.
// The tile names the recorded profession; Change lists every profession by field, then the same rules check for the one
// picked, whose Continue records it (venture.compliance.set) and, when the field changed, the field too.
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { ComplianceLite, EngineClient, MethodName } from '../../src/engine/types';

const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

async function open(recorded: string | null) {
  const engine = new FakeEngine();
  if (recorded) {
    const view = await engine.request('venture.compliance.get', { profession: recorded }) as ComplianceLite;
    await engine.request('venture.compliance.set', { profession: recorded, sideWork: 'allowed', digest: view.digest });
  }
  const fake = createFakeClient(engine);
  const calls: [string, unknown][] = [];
  const client: EngineClient = { ...fake, request: (async (method: MethodName, params?: unknown) => { calls.push([method, params]); return fake.request(method as never, params as never); }) as EngineClient['request'] };
  window.location.hash = '#/business/owner';
  render(<App client={client} language="en" />);
  await settle();
  return { engine, calls, tile: await screen.findByRole('region', { name: 'Your profession' }, { timeout: 4000 }) };
}

describe('Business > About you: your profession (A5)', () => {
  it('names the recorded profession, and a change shows the new rules, records them and the field', async () => {
    const { engine, calls, tile } = await open('home-chef-tiffin');
    expect(within(tile).getByText('Home chef or tiffin')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Your business size' })).toBeTruthy();
    await act(async () => { fireEvent.click(within(tile).getByRole('button', { name: 'Change' })); });
    const select = within(tile).getByRole('combobox', { name: 'Profession' }) as HTMLSelectElement;
    expect([...select.querySelectorAll('optgroup')].map((group) => group.label)).toContain('Licensed work');
    expect(select.querySelectorAll('optgroup option').length).toBe(57);
    expect(select.value).toBe('home-chef-tiffin');
    await act(async () => { fireEvent.change(select, { target: { value: 'advocate' } }); });
    const check = await within(tile).findByRole('region', { name: 'Day job and rules' });
    expect(check.querySelector('[data-profession-rule="bci-rule-36"]')).toBeTruthy();
    await act(async () => { fireEvent.click(within(check).getByRole('radio', { name: 'I am not sure' })); });
    await act(async () => { fireEvent.click(within(check).getByRole('button', { name: 'Continue' })); });
    expect(calls.find(([method]) => method === 'venture.compliance.set')?.[1]).toMatchObject({ profession: 'advocate', sideWork: 'not-sure' });
    expect(calls.find(([method]) => method === 'venture.owner.set')?.[1]).toEqual({ familyId: 'licensed' });
    expect(await within(tile).findByRole('status')).toHaveProperty('textContent', 'Saved. Your rules now follow this profession.');
    await waitFor(() => expect(within(tile).getByText('Advocate')).toBeTruthy());
    // Advocates' rules count no size, so the size setting goes.
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Your business size' })).toBeNull());
    expect(((await engine.request('venture.compliance.get', {})) as ComplianceLite).recorded?.professionId).toBe('advocate');
  }, 20000);

  it('a change inside the same field leaves the field alone, and Cancel changes nothing', async () => {
    const { calls, tile } = await open('doctor');
    await act(async () => { fireEvent.click(within(tile).getByRole('button', { name: 'Change' })); });
    await act(async () => { fireEvent.click(within(tile).getByRole('button', { name: 'Cancel' })); });
    expect(within(tile).queryByRole('combobox', { name: 'Profession' })).toBeNull();
    await act(async () => { fireEvent.click(within(tile).getByRole('button', { name: 'Change' })); });
    await act(async () => { fireEvent.change(within(tile).getByRole('combobox', { name: 'Profession' }), { target: { value: 'advocate' } }); });
    const check = await within(tile).findByRole('region', { name: 'Day job and rules' });
    await act(async () => { fireEvent.click(within(check).getByRole('radio', { name: 'Yes, it allows side work' })); });
    await act(async () => { fireEvent.click(within(check).getByRole('button', { name: 'Continue' })); });
    await within(tile).findByRole('status');
    expect(calls.some(([method]) => method === 'venture.owner.set')).toBe(false);
  }, 20000);

  it('says "Not picked yet" for a business that kept only its field, or nothing', async () => {
    const { tile } = await open('teaching');
    expect(within(tile).getByText('Not picked yet. Your field: Teaching and coaching.')).toBeTruthy();
    expect(within(tile).getByRole('button', { name: 'Pick your profession' })).toBeTruthy();
  });

  it('says "Not picked yet" with no record at all', async () => {
    const { tile } = await open(null);
    expect(within(tile).getByText('Not picked yet.')).toBeTruthy();
    expect(within(tile).getByRole('button', { name: 'Pick your profession' })).toBeTruthy();
  });
});
