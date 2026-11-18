import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';

// C5 task 13: "I charge GST" on Prices. The fields appear only after the switch; each goes through venture.blueprint.update
// under the same owner-set rule as prices; a GSTIN the engine refuses shows the check's words.
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });

function start() {
  window.location.hash = '#/business/prices';
  const fake = createFakeClient(new FakeEngine());
  const spy = vi.fn();
  const client: EngineClient = { ...fake, request: ((method: string, params?: unknown) => { spy(method, params); return fake.request(method as never, params as never); }) as EngineClient['request'] };
  render(<App client={client} language="en" />);
  return spy;
}
const updates = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.filter(([m]) => m === 'venture.blueprint.update').map(([, p]) => (p as { patch: unknown }).patch);

describe('Prices: I charge GST', () => {
  it('shows the rate and GSTIN only after the switch, and sends the patch', async () => {
    const spy = start();
    const section = (await screen.findByRole('checkbox', { name: 'I charge GST' })).closest('section') as HTMLElement;
    const toggle = within(section).getByRole('checkbox', { name: 'I charge GST' }) as HTMLInputElement;
    if (toggle.checked) { await act(async () => { fireEvent.click(toggle); }); await settle(); }
    expect(within(section).queryByLabelText('GSTIN')).toBeNull();
    await act(async () => { fireEvent.click(within(section).getByRole('checkbox', { name: 'I charge GST' })); });
    await settle();
    fireEvent.change(await within(section).findByLabelText('GST rate'), { target: { value: '18' } });
    fireEvent.change(within(section).getByLabelText('GSTIN'), { target: { value: '27ZZZZZ9999Z1Z8' } });
    await act(async () => { fireEvent.click(within(section).getByRole('button', { name: 'Save GST' })); });
    await settle();
    await waitFor(() => expect(updates(spy)).toContainEqual({ taxRegistered: true, taxRate: '18', taxId: '27ZZZZZ9999Z1Z8' }));
    expect(within(section).queryByRole('alert')).toBeNull();
  });

  it('an invalid GSTIN shows the check\'s words', async () => {
    start();
    const section = (await screen.findByRole('checkbox', { name: 'I charge GST' })).closest('section') as HTMLElement;
    const toggle = within(section).getByRole('checkbox', { name: 'I charge GST' }) as HTMLInputElement;
    if (!toggle.checked) { await act(async () => { fireEvent.click(toggle); }); await settle(); }
    fireEvent.change(await within(section).findByLabelText('GSTIN'), { target: { value: 'NOT-A-GSTIN' } });
    await act(async () => { fireEvent.click(within(section).getByRole('button', { name: 'Save GST' })); });
    await settle();
    expect(within(section).getByRole('alert').textContent).toContain('Check your GSTIN.');
  });
});

// Found on the real app, 16 November 2026: with tax left unanswered, Today said "Confirm your tax. Chausar assumed you do
// not charge GST. Say whether you do.", and the page had nothing to press for "No": the tick left off saved nothing.
describe('Prices: an owner who does not charge GST can say so', () => {
  /** A new business whose owner skipped the tax question, with its plan accepted and both prices set. */
  async function assumed() {
    const engine = new FakeEngine({ fresh: true });
    const client = createFakeClient(engine);
    await client.request('workspace.create', { name: 'Indore Custom Cakes', pack: 'services', folder: null } as never);
    await client.request('venture.create', { idea: 'I bake custom cakes in Indore for offices and events.', countryCode: 'IN', workingName: 'Indore Custom Cakes' });
    let view = await client.request('venture.interview.next', { useTemplate: true });
    for (let guard = 0; guard < 12; guard++) {
      const question = view.interview.questions.find((q) => q.answer === null);
      if (!question) break;
      const answer = question.id === 'q_pricing_model' ? { choiceId: question.choices[0]!.id } : question.id === 'q_tax' ? { yes: false, assumed: true } : { skipped: true };
      view = await client.request('venture.interview.answer', { questionId: question.id, answer: answer as never });
    }
    const plan = await client.request('venture.blueprint.draft', { useTemplate: true });
    const first = (await client.request('venture.queue.list', {})).rows.find((row) => row.viewRef?.kind === 'plan')!;
    await client.request('venture.queue.decide', { id: first.id, digest: first.digest, action: 'approve', viewed: true });
    for (const offer of plan.blueprint.offers) await client.request('venture.blueprint.update', { patch: { offers: [{ id: offer.id, unitPrice: '1200' }] }, ownerSave: true });
    return { engine, client };
  }
  const taxCard = async (client: EngineClient) => (await client.request('venture.queue.list', {})).rows.find((row) => row.kind === 'setup' && row.actions.some((action) => action.id === 'set-prices'));
  function open(client: EngineClient) {
    window.location.hash = '#/business/prices';
    const spy = vi.fn();
    const watched: EngineClient = { ...client, request: ((method: string, params?: unknown) => { spy(method, params); return client.request(method as never, params as never); }) as EngineClient['request'] };
    render(<App client={watched} language="en" />);
    return spy;
  }

  it('No is one press: the engine records it as the owner\'s, the question goes, and the Today card goes and stays away', async () => {
    const { client } = await assumed();
    const card = await taxCard(client);
    expect([card?.title, card?.line, card?.actions.map((action) => action.label)]).toEqual(['Confirm your tax', 'Chausar assumed you do not charge GST. Say whether you do.', ['Confirm tax']]);
    const spy = open(client);
    const no = await screen.findByRole('button', { name: "No, I don't charge GST" });
    const section = no.closest('section') as HTMLElement;
    expect(within(section).getByText('Do you charge GST? Chausar assumed you do not.')).toBeTruthy();
    expect(within(section).getByRole('button', { name: 'Yes, I charge GST' })).toBeTruthy();
    expect(within(section).queryByLabelText('GSTIN')).toBeNull();
    await act(async () => { fireEvent.click(no); });
    await settle();
    expect(spy.mock.calls.filter(([m]) => m === 'venture.blueprint.update').map(([, p]) => p)).toEqual([{ patch: { taxRegistered: false }, ownerSave: true }]);
    await within(section).findByText('You said you do not charge GST.');
    await waitFor(() => expect(within(section).queryByRole('button', { name: "No, I don't charge GST" })).toBeNull());
    expect(within(section).queryByText('Do you charge GST? Chausar assumed you do not.')).toBeNull();
    // From here it is the owner's own setting: the tick, off.
    expect((within(section).getByRole('checkbox', { name: 'I charge GST' }) as HTMLInputElement).checked).toBe(false);
    const plan = await client.request('venture.blueprint.get', {});
    expect(plan!.blueprint.backOffice.taxRegistered).toEqual({ value: false, label: 'told-by-you', by: 'owner' });
    expect(plan!.blueprint.status).toBe('accepted');
    expect(await taxCard(client)).toBeUndefined();
    expect((await client.request('venture.queue.list', {})).rows.filter((row) => row.viewRef?.kind === 'plan')).toEqual([]);
    // A later price save does not bring it back.
    await client.request('venture.blueprint.update', { patch: { offers: [{ id: plan!.blueprint.offers[0]!.id, unitPrice: '1500' }] }, ownerSave: true });
    expect(await taxCard(client)).toBeUndefined();
  });

  it('Yes opens the rate, the GSTIN and Save, as before', async () => {
    const { client } = await assumed();
    const spy = open(client);
    const yes = await screen.findByRole('button', { name: 'Yes, I charge GST' });
    const section = yes.closest('section') as HTMLElement;
    await act(async () => { fireEvent.click(yes); });
    expect((await within(section).findByRole('checkbox', { name: 'I charge GST' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(await within(section).findByLabelText('GST rate'), { target: { value: '18' } });
    fireEvent.change(within(section).getByLabelText('GSTIN'), { target: { value: '27ZZZZZ9999Z1Z8' } });
    expect(updates(spy)).toEqual([]);
    await act(async () => { fireEvent.click(within(section).getByRole('button', { name: 'Save GST' })); });
    await settle();
    await waitFor(() => expect(updates(spy)).toContainEqual({ taxRegistered: true, taxRate: '18', taxId: '27ZZZZZ9999Z1Z8' }));
    expect(await taxCard(client)).toBeUndefined();
  });

  it('a business that already answered is not asked again', async () => {
    start();
    await screen.findByRole('checkbox', { name: 'I charge GST' });
    expect(screen.queryByRole('button', { name: /^No, I don't charge/ })).toBeNull();
    expect(screen.queryByText(/Chausar assumed you do not/)).toBeNull();
  });
});
