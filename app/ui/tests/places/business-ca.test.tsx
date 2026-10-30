import { expect, it } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
it('shows the exact dated rules before confirming with the CA membership number', async () => {
    const engine = new FakeEngine();
    await engine.request('workspace.open', { folder: 'ledgerline' });
    window.location.hash = '#/business/ca';
    render(<App client={createFakeClient(engine)} language="en"/>);
    const heading = await screen.findByText('Tax rules to confirm', { selector: 'h2' });
    const card = heading.closest('section')!;
    fireEvent.click(within(card).getByText('Review rules'));
    expect(within(card).getByText('80C')).toBeTruthy();
    expect(within(card).getAllByText('2027-28')).toHaveLength(2);
    fireEvent.change(within(card).getByLabelText("Your CA's membership number"), { target: { value: '999999' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Confirm these rules' }));
    expect(await within(card).findByRole('alert')).toBeTruthy();
    fireEvent.change(within(card).getByLabelText("Your CA's membership number"), { target: { value: '412345' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Confirm these rules' }));
    await waitFor(() => expect(within(card).queryByRole('button', { name: 'Confirm these rules' })).toBeNull());
    expect((await engine.request('venture.ca.get', {}) as any).citations.confirmedBy.membershipNumber).toBe('412345');
});
it('fake confirmation refuses stale versions and extra fields, then returns engine-shaped data', async () => {
    const engine = new FakeEngine();
    await engine.request('workspace.open', { folder: 'ledgerline' });
    await expect(engine.request('venture.ca.confirmCitations', { version: 999, membershipNo: '412345' })).rejects.toMatchObject({ code: 'CITATIONS_STALE' });
    await expect(engine.request('venture.ca.confirmCitations', { version: 1, membershipNo: '412345', extra: true } as any)).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    const saved: any = await engine.request('venture.ca.confirmCitations', { version: 1, membershipNo: '412345' });
    expect(saved.confirmedBy.membershipNumber).toBe('412345');
    expect(saved.tableHash).toMatch(/^[a-f0-9]{64}$/);
});
it('income intake offers multiple choices and keeps technical follow-ups one fold away', async () => {
    const { KitIntakeFields } = await import('../../src/places/work/KitIntakeFields');
    const { TextProvider } = await import('../../src/text');
    const { EngineProvider } = await import('../../src/engine/context');
    const changes: any[] = [];
    render(<EngineProvider client={createFakeClient(new FakeEngine())}><TextProvider language="en"><KitIntakeFields ask={{ rights: [], fields: [], kit: [{ id: 'incomeKinds', kind: 'list', label: 'Income sources', help: 'Choose all.', required: false, options: ['salary', 'business'] }, { id: 'questions', kind: 'text', label: 'Further tax questions', help: 'Second round.', required: false }] }} answers={{ incomeKinds: 'salary' }} onChange={value => changes.push(value)}/></TextProvider></EngineProvider>);
    fireEvent.click(screen.getByLabelText('business'));
    expect(changes.at(-1).incomeKinds).toBe('salary\nbusiness');
    expect(screen.getByText('Further tax questions', { selector: 'summary' }).closest('details')).toBeTruthy();
});
it('sample CA plan exposes every new offer with the same first-round intake', async () => {
    const engine = new FakeEngine();
    await engine.request('workspace.open', { folder: 'ledgerline' });
    const view: any = await engine.request('venture.blueprint.get', {});
    for (const key of ['itr-form-and-regime', 'itr-computation-only', 'itr-check-draft', 'itr-checklist', 'check-return-elsewhere', 'advance-tax-freelancer', 'tax-question-desk']) {
        const offer = view.blueprint.offers.find((row: any) => row.playbookOffer === key);
        expect(offer, key).toBeTruthy();
        expect(view.intake[offer.id].kit[0].id).toBe('incomeKinds');
        expect(offer.pricing.unitPriceMinor).toBeNull();
    }
});
it('stored signatures validate ids and recheck their captured receipt content', async () => {
    const engine = new FakeEngine();
    await engine.request('workspace.open', { folder: 'ledgerline' });
    for (const id of ['', 'not an id'])
        await expect(engine.request('venture.ca.signoff.get', { id })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    const queue: any = await engine.request('venture.queue.list', {});
    const row = queue.rows.find((r: any) => r.actions.some((a: any) => a.id === 'send-to-ca'));
    await engine.request('venture.queue.decide', { id: row.id, digest: row.digest, action: 'send-to-ca', viewed: true });
    const answer: any = await engine.request('venture.ca.recordSignoff', { requestId: 'ca-req-gst-sep', membershipNo: '412345' });
    const signed: any = await engine.request('venture.ca.signoff.get', { id: answer.request.signoffId });
    expect(signed.ca.membershipNumber).toBe('412345');
    expect(signed.receipts.length).toBe(2);
    expect(signed.rederived).toBe('differs');
    expect(signed.differs.key).toBe('w-portal-sep');
});
