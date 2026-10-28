// Dated ITR choices, original Chausar tests informed by official form instructions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseItrForm, formIntake } from '../runtime/venture/playbooks/ca-firm/itr-forms.ts';
const use = { mode: 'rehearsal' as const, confirmedBy: null };
const facts = { entity: 'individual', residency: 'resident', incomeKinds: ['salary', 'house-property'], totalIncomeMinor: '200000000', houseProperties: 2, hasBusinessIncome: false, presumptive: false, capitalGains: 'none', capitalGainsMinor: '0', agricultureMinor: '0', exclusions: [], regimeLastYear: 'new', wantedRegime: 'new', switchedBack: false };
test('first matching dated row permits two houses in AY 2026-27, excludes special cases and holds unverified years', () => {
    assert.equal(chooseItrForm({ assessmentYear: '2026-27', facts }, use).form, 'ITR-1');
    assert.equal(chooseItrForm({ assessmentYear: '2026-27', facts: { ...facts, houseProperties: 3 } }, use).form, 'ITR-2');
    assert.equal(chooseItrForm({ assessmentYear: '2026-27', facts: { ...facts, exclusions: ['foreign-assets'] } }, use).form, 'ITR-2');
    assert.equal(chooseItrForm({ assessmentYear: '2026-27', facts: { ...facts, hasBusinessIncome: true, presumptive: true } }, use).form, 'ITR-4');
    assert.equal(chooseItrForm({ assessmentYear: '2026-27', facts: { ...facts, hasBusinessIncome: true, presumptive: false } }, use).form, 'ITR-3');
    assert.equal(chooseItrForm({ assessmentYear: '2027-28', facts }, use).verification, 'not verified, needs CA confirmation');
    assert.throws(() => chooseItrForm({ assessmentYear: '2027-28', facts }, { mode: 'client', confirmedBy: null }), (e: any) => e.code === 'CITATIONS_UNCONFIRMED');
    assert.throws(() => chooseItrForm({ assessmentYear: '2028-29', facts }, use), (e: any) => e.code === 'RATE_TABLE_STALE');
});
test('business regime history prevents a second return to old; existing table facts remove redundant intake questions', () => {
    const answer = chooseItrForm({ assessmentYear: '2026-27', facts: { ...facts, hasBusinessIncome: true, wantedRegime: 'old', switchedBack: true } }, use);
    assert.equal(answer.regime.allowed, false);
    const first = chooseItrForm({ assessmentYear: '2026-27', facts: { ...facts, hasBusinessIncome: true, wantedRegime: 'old' } }, use);
    assert.equal(first.regime.form, 'Form 10-IEA');
    const intake = formIntake({}, [{ columns: ['Source', 'Category'], rows: [{ cells: { Source: 'Form 16 typed table', Category: 'Salary' } }] }]);
    assert.deepEqual(intake.facts.incomeKinds, ['salary']);
    assert.equal(intake.questions.some(q => q.field === 'incomeKinds'), false);
    assert.ok(intake.questions.every(q => q.why.length > 10));
    assert.throws(() => chooseItrForm({ assessmentYear: '2026-27', facts: {} }, use), (e: any) => e.code === 'NEEDS_FACTS' && e.details.question.en.length > 0);
});
test('missing form facts ask the exact fact with a reason instead of asking for income already supplied', () => {
    const { houseProperties, ...known } = facts;
    assert.throws(() => chooseItrForm({ assessmentYear: '2026-27', facts: known }, use), (e: any) => e.code === 'NEEDS_FACTS' && e.details.missing.some((row: any) => row.field === 'houseProperties') && /house/i.test(e.details.question.en) && !/what you earned/i.test(e.details.question.en));
});
test('contradictory capital gains and presumptive facts cannot select a simple form', () => {
    assert.throws(() => chooseItrForm({ assessmentYear: '2026-27', facts: { ...facts, capitalGainsMinor: '20000000' } }, use), (e: any) => e.code === 'TAX_INPUT_INVALID');
    assert.throws(() => chooseItrForm({ assessmentYear: '2026-27', facts: { ...facts, presumptive: true } }, use), (e: any) => e.code === 'TAX_INPUT_INVALID');
});
