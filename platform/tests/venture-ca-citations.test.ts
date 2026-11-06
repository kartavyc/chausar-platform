// CA2 citation rules, original Chausar tests. Unknown sections never pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCitations, CITATION_TABLE, citationUseFor } from '../runtime/venture/playbooks/ca-firm/citations.ts';
import { setup, owner } from './venture-views-env.ts';
import { handlers } from '../runtime/venture/playbooks/index.ts';
import { setCaOfRecord } from '../runtime/venture/playbooks/ca-firm/signoff.ts';
const rehearsal = { mode: 'rehearsal' as const, confirmedBy: null };
test('old sections require a specific current-Act mapping note; unknown references fail even in rehearsal', () => {
    const draft = 'section 80C; u/s 194J; Sec. 44AD.';
    assert.equal(checkCitations({ draft, incomeDate: '2026-03-31' }, rehearsal).passed, true);
    assert.equal(checkCitations({ draft, incomeDate: '2026-04-01' }, rehearsal).passed, false);
    const notes = 'Mapping note: 80C -> Income-tax Act 2025 section 123; 194J -> Income-tax Act 2025 section 393; 44AD -> Income-tax Act 2025 section 58.';
    assert.equal(checkCitations({ draft: draft + notes, incomeDate: '2026-04-01' }, rehearsal).passed, true);
    assert.equal(checkCitations({ draft: 'Section 999Z allows this.', incomeDate: '2026-04-01' }, rehearsal).passed, false);
    assert.equal(checkCitations({ draft: 'Section 123 of Income-tax Act 2025 applies.', incomeDate: '2026-04-01' }, rehearsal).passed, true);
    assert.equal(checkCitations({ draft: 'Sec. 80C(99) applies.', incomeDate: '2026-03-31' }, rehearsal).passed, false);
    assert.ok(CITATION_TABLE.rows.every(row => row.source && row.validFrom && row.validTo));
});
test('only the app and matching CA can confirm the immutable current table version for client use', async () => {
    const env = await setup();
    await setCaOfRecord(env.deps, owner, { name: 'CA Asha Rao', membershipNumber: '123456' });
    const confirm = handlers['venture.ca.confirmCitations']!;
    assert.throws(() => checkCitations({ draft: 'section 80C', incomeDate: '2026-03-31' }, citationUseFor(env.store.read(), env.venture.id, 'client')), (e: any) => e.code === 'CITATIONS_UNCONFIRMED');
    await assert.rejects(confirm(env.deps, { ...owner, channel: 'whatsapp' } as any, { version: CITATION_TABLE.version, membershipNo: '123456' }));
    await assert.rejects(confirm(env.deps, owner, { version: CITATION_TABLE.version, membershipNo: '654321' }), (e: any) => e.code === 'CA_NOT_OF_RECORD');
    await assert.rejects(confirm(env.deps, owner, { version: 999, membershipNo: '123456' }), (e: any) => e.code === 'CITATIONS_STALE');
    const saved: any = await confirm(env.deps, owner, { version: CITATION_TABLE.version, membershipNo: '123456' });
    assert.equal(saved.confirmedBy.name, 'CA Asha Rao');
    assert.equal(checkCitations({ draft: 'section 80C', incomeDate: '2026-03-31' }, citationUseFor(env.store.read(), env.venture.id, 'client')).passed, true);
});
test('bare tax references and impossible dates cannot bypass the dated register', () => {
    assert.equal(checkCitations({ draft: 'Deduct under 80C.', incomeDate: '2026-04-01' }, rehearsal).passed, false);
    assert.equal(checkCitations({ draft: 'Income-tax Act 2025 section 123 applies. Section 80C needs its own mapping.', incomeDate: '2026-04-01' }, rehearsal).passed, false);
    assert.throws(() => checkCitations({ draft: 'section 80C', incomeDate: '2026-02-30' }, rehearsal));
});
test('every member of a section list must be checked', () => { assert.equal(checkCitations({ draft: 'Sections 80C and 999 apply.', incomeDate: '2025-10-01' }, rehearsal).passed, false); assert.equal(checkCitations({ draft: 'Sections 80C, 44AD and 194J apply.', incomeDate: '2025-10-01' }, rehearsal).findings.length, 3); });
test('a known section prefix cannot validate a longer unknown number or range',()=>{
 assert.equal(checkCitations({draft:'Section 1234 applies.',incomeDate:'2026-05-01'},rehearsal).passed,false);
 assert.equal(checkCitations({draft:'Sections 123 to 999 apply.',incomeDate:'2026-05-01'},rehearsal).passed,false);
});
