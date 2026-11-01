// Wave 6, 6E4 and 6E5: the document desk and the sign-off desk on Work, against the fake engine, which runs the
// engine's own pure cores (document-desk/core.ts, signoff-desk/core.ts). Figures come from code; a sign-off desk draft
// is not accepted until its named professional signs; Ink rules hold.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TextProvider } from '../../src/text';
import { EngineProvider } from '../../src/engine/context';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { DocumentDeskDesk } from '../../src/places/work/desks/DocumentDeskDesk';
import { SignoffDeskDesk } from '../../src/places/work/desks/SignoffDeskDesk';
import { deskReady } from '../../src/places/work/PlaybookDesk';
import { assertInkRules } from '../helpers/ink-rules';

async function business(idea: string, offerKey: string) {
  const engine = createFakeClient(new FakeEngine({ fresh: true }));
  await engine.request('workspace.create', { name: 'Desk Studio', pack: 'services' });
  await engine.request('venture.create', { idea, countryCode: 'IN', workingName: 'Desk Studio' });
  for (const [questionId, answer] of [['q_1', { skipped: true }], ['q_pricing_model', { choiceId: 'monthly' }], ['q_price', { skipped: true }], ['q_tax', { yes: false }]] as const) await engine.request('venture.interview.answer', { questionId, answer });
  const plan = await engine.request('venture.blueprint.draft', { useTemplate: true });
  const priced = await engine.request('venture.blueprint.update', { patch: { offers: plan.blueprint.offers.map(row => ({ id: row.id, unitPrice: '1000' })) } });
  const approval = (await engine.request('venture.queue.list', {})).rows.find(row => row.viewRef?.kind === 'plan' && row.viewRef.id === priced.blueprint.id)!;
  await engine.request('venture.queue.decide', { id: approval.id, digest: approval.digest, action: 'approve', viewed: true });
  const client = await engine.request('venture.client.add', { name: 'Asha Rao', email: 'asha@example.test', countryCode: 'IN' });
  const offer = priced.blueprint.offers.find(row => row.playbookOffer === offerKey)!;
  expect(offer, offerKey).toBeTruthy();
  const order = await engine.request('venture.order.create', { clientId: client.id, offerId: offer.id, request: 'A document for the client', intake: { fields: { scope: 'The work.', deliverable: 'One paper.' } } });
  return { engine, order };
}
const desk = (engine: any, playbook: string, kind: string, id: string, action?: string, payload?: unknown, digest?: string) =>
  action ? engine.request('venture.desk.act', { playbook, kind, id, action, payload, ...(digest ? { digest } : {}) }) : engine.request('venture.desk.get', { playbook, kind, id });

describe('6E4 document desk', () => {
  it('is a ready desk; the fake answers with code-computed figures and the engine codes', async () => {
    expect(deskReady('document-desk')).toBe(true);
    const { engine, order } = await business('A document desk for HR handbooks and SOPs in Pune', 'handbook-sop');
    const file = await engine.request('venture.files.add', { orderId: order.id, name: 'policy.csv', contentBase64: btoa('policy\nStaff work six days a week.') });
    await desk(engine, 'document-desk', 'document', order.id, 'create', { docType: 'estimate', title: 'Fit-out estimate', sourceFileIds: [file.id] });
    let view: any = await desk(engine, 'document-desk', 'document', order.id);
    await desk(engine, 'document-desk', 'document', order.id, 'figures', { currency: 'INR', lines: [{ label: 'Printing', quantity: '2.5', unit: '333.33' }] }, view.digest);
    view = await desk(engine, 'document-desk', 'document', order.id);
    expect(view.item.figures.totalMinor).toBe('83333');
    expect(view.item.figureWords[0]).toBe('Printing: 2.5 at INR 333.33 is INR 833.33');
    await expect(desk(engine, 'document-desk', 'document', order.id, 'section', { sectionId: 'section-1', text: 'It costs INR 900.' }, view.digest)).rejects.toMatchObject({ code: 'DOCUMENT_FIGURE_UNRECEIPTED' });
    await expect(desk(engine, 'document-desk', 'document', order.id, 'approve', {}, view.digest)).rejects.toMatchObject({ code: 'DOCUMENT_BRIEF_REQUIRED' });
    await expect(desk(engine, 'document-desk', 'document', order.id, 'outline', { sections: [] }, 'stale')).rejects.toMatchObject({ code: 'APPROVAL_CHANGED' });
  });

  it('sets up a document from the order files on screen, with Ink rules', async () => {
    const { engine, order } = await business('A document desk for HR handbooks and SOPs in Pune', 'handbook-sop');
    await engine.request('venture.files.add', { orderId: order.id, name: 'policy.csv', contentBase64: btoa('policy\nStaff work six days a week.') });
    render(<TextProvider language="en"><EngineProvider client={engine}><DocumentDeskDesk /></EngineProvider></TextProvider>);
    const select = await screen.findByLabelText('Client order');
    await waitFor(() => expect(select.querySelector(`option[value="${order.id}"]`)).not.toBeNull());
    fireEvent.change(select, { target: { value: order.id } });
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Staff handbook' } });
    fireEvent.click(await screen.findByLabelText('policy.csv'));
    fireEvent.click(screen.getByRole('button', { name: 'Set up the document' }));
    expect(await screen.findByRole('button', { name: 'Approve brief' })).toBeTruthy();
    expect(screen.getByLabelText('Purpose and scope')).toBeTruthy();
    assertInkRules();
  });
});

describe('6E5 sign-off desk', () => {
  it('names the professional, refuses a bad number, lists the rules honestly, and holds Accept until signed', async () => {
    expect(deskReady('signoff-desk')).toBe(true);
    const { engine, order } = await business('A sign-off desk for an advocate in Pune', 'legal-drafting');
    await expect(desk(engine, 'signoff-desk', 'professional', 'advocate', 'name', { name: 'Meera Joshi', registrationNumber: '1234' })).rejects.toMatchObject({ code: 'SIGNOFF_REGISTRATION_INVALID' });
    await desk(engine, 'signoff-desk', 'professional', 'advocate', 'name', { name: 'Meera Joshi', registrationNumber: 'mah/1234/2015' });
    const people: any = await engine.request('venture.desk.list', { playbook: 'signoff-desk', kind: 'professional' });
    const advocate = people.rows.find((row: any) => row.profession === 'advocate');
    expect(advocate.professional).toMatchObject({ name: 'Meera Joshi', registrationNumber: 'MAH/1234/2015' });
    expect(advocate.switchedOff.map((row: any) => row.tool)).toEqual(['outreach', 'advertising']);
    expect(advocate.rules.every((rule: any) => rule.checked === false)).toBe(true);
    const run: any = await engine.request('venture.delivery.run', { orderId: order.id, useTemplate: true }).catch((error: any) => error);
    expect(run?.id, JSON.stringify(run)).toBeTruthy();
    await expect(engine.request('venture.delivery.review', { runId: run.id, verdict: 'accepted' })).rejects.toMatchObject({ code: 'SIGNOFF_REQUIRED' });
  });

  it('shows who signs and the papers on screen, with Ink rules', async () => {
    const { engine } = await business('A sign-off desk for an advocate in Pune', 'legal-drafting');
    render(<TextProvider language="en"><EngineProvider client={engine}><SignoffDeskDesk /></EngineProvider></TextProvider>);
    expect(await screen.findByText('Advocate')).toBeTruthy();
    expect(screen.getByText('Advocates do not solicit clients, so outreach is switched off.')).toBeTruthy();
    expect(screen.getByText('Drafts for regulated work appear here.')).toBeTruthy();
    assertInkRules();
  });
});
