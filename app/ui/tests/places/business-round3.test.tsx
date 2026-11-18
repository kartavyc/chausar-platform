import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { BlueprintViewLite, EngineClient, QueueList } from '../../src/engine/types';

/**
 * The newest Windows build (15 Nov 2026, third round), Settings:
 *   - changing an offer's unit on Prices, even straight back, made the owner accept the whole plan again, and that
 *     card's Read did nothing on the Prices page; "Type a price first." stayed under an offer after its price saved;
 *   - "How the work is done" said "Service business · Version 5, accepted" over a business with its own name, kept
 *     "assumption" beside the name and the summary of a plan the owner had accepted, and said "Plan accepted." twice.
 */
type Call = [string, Record<string, unknown>];
function start(hash: string, engine = new FakeEngine()) {
  window.location.hash = hash;
  const fake = createFakeClient(engine);
  const calls: Call[] = [];
  const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => { calls.push([method, structuredClone(params ?? {})]); return fake.request(method as never, params as never); }) as EngineClient['request'] };
  render(<App client={client} language="en" />);
  return { engine, calls };
}
const plan = async (engine: FakeEngine) => (await engine.request('venture.blueprint.get', {})) as BlueprintViewLite;
const offerRow = async (name: string) => (await screen.findByText(name, { selector: '[data-offer-name]' })).closest('li')!;
const press = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element); }); };

describe('Prices: the unit is the owner\'s own setting', () => {
  it('a new unit applies at once with Undo: the plan stays accepted and nothing waits to be accepted again', async () => {
    const { engine, calls } = start('#/business/prices');
    const first = (await plan(engine)).blueprint;
    expect(first.status).toBe('accepted');
    const before = ((await engine.request('venture.queue.list', {})) as QueueList).rows.map((row) => row.id);
    const offer = first.offers[0]!;
    const was = offer.pricing.quantityUnit;
    const label = `How ${offer.name.value} is priced`;
    const unit = await screen.findByRole('combobox', { name: label }) as HTMLSelectElement;
    await act(async () => { fireEvent.change(unit, { target: { value: 'visit' } }); });
    await waitFor(() => expect(calls.filter(([method]) => method === 'venture.blueprint.update').map(([, params]) => params)).toContainEqual({ patch: { offers: [{ id: offer.id, unit: 'visit' }] }, ownerSave: true }));
    const decided = await screen.findByText(`You set ${offer.name.value} to be priced per visit.`);
    expect((await plan(engine)).blueprint.status).toBe('accepted');
    expect((await plan(engine)).blueprint.offers[0]!.pricing.quantityUnit).toBe('visit');
    expect(screen.queryByText('Waiting on you', { selector: 'h2' })).toBeNull();
    expect(screen.queryByText('Your plan changed. Read it, then accept it.')).toBeNull();
    expect(((await engine.request('venture.queue.list', {})) as QueueList).rows.map((row) => row.id).filter((id) => !before.includes(id))).toEqual([]);
    // Undo puts the unit back, and says so.
    await press(within(decided.closest('[data-price-decided]') as HTMLElement).getByRole('button', { name: 'Undo' }));
    await screen.findByText(`You took back the new unit for ${offer.name.value}.`);
    await waitFor(() => expect((screen.getByRole('combobox', { name: label }) as HTMLSelectElement).value).toBe(was));
    expect((await plan(engine)).blueprint.status).toBe('accepted');
    expect(screen.queryByText('Waiting on you', { selector: 'h2' })).toBeNull();
  }, 20000);

  it('changing a unit and changing it back leaves nothing to accept', async () => {
    const { engine } = start('#/business/prices');
    const offer = (await plan(engine)).blueprint.offers[0]!;
    const label = `How ${offer.name.value} is priced`;
    const choose = async (value: string) => {
      await act(async () => { fireEvent.change(screen.getByRole('combobox', { name: label }), { target: { value } }); });
      await waitFor(() => expect((screen.getByRole('combobox', { name: label }) as HTMLSelectElement).value).toBe(value));
    };
    await screen.findByRole('combobox', { name: label });
    await choose('piece');
    await choose(offer.pricing.quantityUnit);
    expect((await plan(engine)).blueprint.status).toBe('accepted');
    expect(screen.queryByText('Waiting on you', { selector: 'h2' })).toBeNull();
  }, 20000);

  it('"Type a price first." leaves once a price is typed, and is not there after the price saved', async () => {
    start('#/business/prices');
    const shorts = await offerRow('Shorts from your long video');
    await press(within(shorts).getByRole('button', { name: 'Save price' }));
    expect(within(shorts).getByText('Type a price first.')).toBeTruthy();
    fireEvent.change(within(shorts).getByLabelText('New price for Shorts from your long video, in INR'), { target: { value: '12000' } });
    expect(within(shorts).queryByText('Type a price first.')).toBeNull();
    // Asked again with nothing typed, then the unit is changed: the line about the empty price box does not stay.
    fireEvent.change(within(shorts).getByLabelText('New price for Shorts from your long video, in INR'), { target: { value: '' } });
    await press(within(shorts).getByRole('button', { name: 'Save price' }));
    expect(within(shorts).getByText('Type a price first.')).toBeTruthy();
    fireEvent.change(within(shorts).getByLabelText('New price for Shorts from your long video, in INR'), { target: { value: '12000' } });
    await press(within(shorts).getByRole('button', { name: 'Save price' }));
    await screen.findByText('You set the price of Shorts from your long video to ₹12,000 a project.');
    expect(within(await offerRow('Shorts from your long video')).queryByText('Type a price first.')).toBeNull();
  }, 20000);

  it('Read on a plan that waits takes the owner from Prices to the plan itself', async () => {
    const engine = new FakeEngine();
    // A change that is not the owner's own price or unit still waits: here, new words.
    await engine.request('venture.blueprint.update', { patch: { oneLiner: 'Short videos for busy founders.' } });
    start('#/business/prices', engine);
    const waiting = (await screen.findByText('Waiting on you', { selector: 'h2' })).closest('section')!;
    await press(within(waiting).getByRole('button', { name: 'Read' }));
    await waitFor(() => expect(window.location.hash).toBe('#/business/plan'));
    const name = await waitFor(() => { const found = document.getElementById('business-plan-name'); if (!found) throw new Error('no plan yet'); return found; });
    await waitFor(() => expect(document.activeElement).toBe(name));
  }, 20000);
});

describe('How the work is done: an accepted plan', () => {
  it('says "Plan accepted." once, however many plan rows were decided in this session', async () => {
    const engine = new FakeEngine();
    await engine.request('venture.blueprint.update', { patch: { oneLiner: 'Short videos for busy founders.' } });
    start('#/business/plan', engine);
    const accept = async () => {
      const waiting = (await screen.findByText('Waiting on you', { selector: 'h2' })).closest('section')!;
      await press(await within(waiting).findByRole('button', { name: 'Accept' }));
      const again = within(waiting).queryByRole('button', { name: /Accept/ });
      if (again) await press(again);
      await waitFor(async () => expect((await plan(engine)).blueprint.status).toBe('accepted'));
    };
    await accept();
    await screen.findByText('Plan accepted.');
    await act(async () => { await engine.request('venture.blueprint.update', { patch: { oneLiner: 'Short videos for founders with no time.' } }); });
    await accept();
    await waitFor(() => expect(screen.getAllByText('Plan accepted.')).toHaveLength(1));
  }, 30000);

  it('an accepted plan carries no "assumption" beside its name and summary; a draft still does', async () => {
    const engine = new FakeEngine();
    start('#/business/plan', engine);
    const name = await waitFor(() => { const found = document.getElementById('business-plan-name'); if (!found) throw new Error('no plan yet'); return found; });
    const card = name.closest('section')!;
    expect((await plan(engine)).blueprint.status).toBe('accepted');
    expect(within(card).queryByText('assumption')).toBeNull();
    expect(screen.queryByText('assumption')).toBeNull();
    // A plan still to accept says which of its words Chausar assumed.
    await act(async () => { await engine.request('venture.blueprint.update', { patch: { customer: 'Founders who post every week.' } }); });
    await waitFor(async () => expect((await plan(engine)).blueprint.status).toBe('draft'));
    await waitFor(() => expect(screen.getAllByText('assumption').length).toBeGreaterThan(0));
  }, 20000);

  it('a business with its own name is not headed by the plain plan\'s label "Service business"', async () => {
    // A potter's business: the plain service type, no playbook of its own, and a name the owner kept.
    const engine = new FakeEngine();
    const view = await plan(engine);
    const potter: BlueprintViewLite = { ...view, blueprint: { ...view.blueprint, serviceType: 'other', name: { ...view.blueprint.name, value: 'Pune Handmade Pottery' } } };
    delete (potter as { playbook?: unknown }).playbook;
    window.location.hash = '#/business/plan';
    const fake = createFakeClient(engine);
    const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => (method === 'venture.blueprint.get' ? Promise.resolve(structuredClone(potter)) : fake.request(method as never, params as never))) as EngineClient['request'] };
    render(<App client={client} language="en" />);
    const name = await waitFor(() => { const found = document.getElementById('business-plan-name'); if (!found) throw new Error('no plan yet'); return found; });
    expect(name.textContent).toContain('Pune Handmade Pottery');
    const card = name.closest('section')!;
    expect(card.textContent).toContain(`Version ${view.blueprint.version}, accepted`);
    expect(card.textContent).not.toContain('Service business');
    expect(card.textContent).not.toMatch(/·\s*Version/);
  }, 20000);

  it('a plan with a kind of its own still says it before the version', async () => {
    const engine = new FakeEngine();
    const view = await plan(engine);
    start('#/business/plan', engine);
    const name = await waitFor(() => { const found = document.getElementById('business-plan-name'); if (!found) throw new Error('no plan yet'); return found; });
    await waitFor(() => expect(name.closest('section')!.textContent).toContain(`YouTube channel · Version ${view.blueprint.version}, accepted`));
  }, 20000);
});
