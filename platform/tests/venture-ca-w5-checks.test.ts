// C1 live check coverage and offer availability.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CA_OFFERS, CA_STEPS } from '../runtime/venture/playbooks/ca-firm/playbook.ts';
import { runFlagshipChecks, type FlagshipCheckInput } from '../runtime/venture/playbooks/draft-checks.ts';
const input = (offerKey: string, sections: any[]): FlagshipCheckInput => ({ flagship: 'ca-firm', offerKey, servedBy: 'model', mode: 'client', today: '2026-10-27', dateOrder: 'day-month-year', request: 'Please prepare the note.', intake: null, files: [], receipts: [], known: [], deliverable: { title: 'CA note', questionsForClient: [], sections }, toolCalls: [] });
test('new CA offers are selectable and the preparer can run all three dated tools', () => {
    for (const id of ['itr-form-and-regime', 'itr-computation-only', 'itr-check-draft', 'itr-checklist', 'check-return-elsewhere', 'advance-tax-freelancer', 'tax-question-desk'])
        assert.equal(CA_OFFERS.find(row => row.id === id)?.regulated, true, id);
    for (const tool of ['tax.citations', 'tax.formChooser', 'tax.advance'])
        assert.ok(CA_STEPS.some(step => (step.tools as readonly string[]).includes(tool)), tool);
});
test('actual CA verification rejects a question without source-backed fact-check form and an unlabelled advance estimate', async () => {
    const q = await runFlagshipChecks(input('tax-question-desk', [{ heading: 'Answer', parts: [{ kind: 'text', text: 'You qualify.' }] }]));
    assert.equal(q.find(row => row.check === 'fact-check-form')?.outcome, 'fail');
    const a = await runFlagshipChecks(input('advance-tax-freelancer', [{ heading: 'Working', parts: [{ kind: 'text', text: 'The tax is final.' }] }]));
    assert.equal(a.find(row => row.check === 'assumption-labelled')?.outcome, 'fail');
    const c = await runFlagshipChecks(input('itr-checklist', [{ heading: 'Working', parts: [{ kind: 'text', text: 'Section 999Z applies.' }] }]));
    assert.equal(c.find(row => row.check === 'citations-current')?.outcome, 'fail');
});
test('the final draft uses the dated confirmed register in place of ad hoc section approval', async () => {
    const c = input('itr-checklist', [{ heading: 'Working', parts: [{ kind: 'text', text: 'Section 80C applies.' }] }]);
    c.intake = { fields: { incomeDate: '2026-03-31' } } as any;
    c.caCitationUse = { mode: 'client', confirmedBy: { name: 'CA Asha', membershipNumber: '123456', at: '2026-10-27' } };
    const rows = await runFlagshipChecks(c);
    assert.equal(rows.find(row => row.check === 'citations-current')?.outcome, 'pass');
    assert.equal(rows.find(row => row.check === 'sections-flagged')?.outcome, 'pass');
});
test('actual final draft gate checks plural unknown section references', async () => {
    const c = input('itr-checklist', [{ heading: 'Working', parts: [{ kind: 'text', text: 'Sections 999 and 998 apply.' }] }]);
    c.intake = { fields: { incomeDate: '2026-03-31' } } as any;
    c.caCitationUse = { mode: 'client', confirmedBy: { name: 'CA Asha', membershipNumber: '123456', at: '2026-10-27' } };
    const rows = await runFlagshipChecks(c);
    assert.equal(rows.find(row => row.check === 'citations-current')?.outcome, 'fail');
});
test('a form and regime draft cannot pass without the actual dated chooser result', async () => {
    const rows = await runFlagshipChecks(input('itr-form-and-regime', [{ heading: 'Working', parts: [{ kind: 'text', text: 'Use ITR-1.' }] }]));
    assert.equal(rows.find(row => row.check === 'form-choice')?.outcome, 'fail');
});
