// One-shot A5 (founder answer 3a): the profession confirmed in onboarding can be changed later in Business > About you.
// The tile names the recorded profession; Change lists every profession by field, then the same rules check for the one
// picked, whose Continue records it (venture.compliance.set) and, when the field changed, the field too.
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type ComplianceLite, type EngineClient, type MethodName } from '../../src/engine/types';

const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

async function open(recorded: string | null, fail: string | null = null) {
  const engine = new FakeEngine();
  if (recorded) {
    const view = await engine.request('venture.compliance.get', { profession: recorded }) as ComplianceLite;
    await engine.request('venture.compliance.set', { profession: recorded, sideWork: 'allowed', digest: view.digest });
  }
  const fake = createFakeClient(engine);
  const calls: [string, unknown][] = [];
  const client: EngineClient = { ...fake, request: (async (method: MethodName, params?: unknown) => { calls.push([method, params]); if (method === fail && (method !== 'venture.owner.set' || calls.filter(([name]) => name === method).length === 1)) throw new EngineError('VAULT_BUSY', 'Chausar is busy. Try again.'); return fake.request(method as never, params as never); }) as EngineClient['request'] };
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

describe('Business > About you: a profession change is all or nothing (A5 fix round 1)', () => {
  async function change(fail: string) {
    const opened = await open('home-chef-tiffin', fail);
    await act(async () => { fireEvent.click(within(opened.tile).getByRole('button', { name: 'Change' })); });
    await act(async () => { fireEvent.change(within(opened.tile).getByRole('combobox', { name: 'Profession' }), { target: { value: 'advocate' } }); });
    const check = await within(opened.tile).findByRole('region', { name: 'Day job and rules' });
    await act(async () => { fireEvent.click(within(check).getByRole('radio', { name: 'I am not sure' })); });
    await act(async () => { fireEvent.click(within(check).getByRole('button', { name: 'Continue' })); });
    return opened;
  }

  it('sets the field first, so a field that fails records no profession', async () => {
    const { engine, calls, tile } = await change('venture.owner.set');
    expect(await within(tile).findByRole('alert')).toHaveProperty('textContent', 'Chausar is busy. Try again.');
    expect(calls.some(([method]) => method === 'venture.compliance.set')).toBe(false);
    expect(((await engine.request('venture.compliance.get', {})) as ComplianceLite).recorded?.professionId).toBe('home-chef-tiffin');
    // The change stays open, so the owner can try again.
    expect(within(tile).getByRole('combobox', { name: 'Profession' })).toBeTruthy();
  }, 20000);

  it('puts the field back when the profession then fails to record', async () => {
    const { calls, tile } = await change('venture.compliance.set');
    expect(await within(tile).findByRole('alert')).toHaveProperty('textContent', 'Chausar is busy. Try again.');
    const fields = calls.filter(([method]) => method === 'venture.owner.set').map(([, params]) => params);
    expect(fields).toEqual([{ familyId: 'licensed' }, { familyId: 'local-services' }]);
    const order = calls.map(([method]) => method).filter((method) => method === 'venture.owner.set' || method === 'venture.compliance.set');
    expect(order).toEqual(['venture.owner.set', 'venture.compliance.set', 'venture.owner.set']);
  }, 20000);
});
