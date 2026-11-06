// CA11 clean, messy and pushy practice cases, original Chausar tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CA_PRACTICE } from '../runtime/venture/playbooks/ca-firm/practice.ts';
import { checkCaDraft } from '../runtime/venture/playbooks/ca-firm/claims.ts';
test('practice includes duplicate bill, missing PAN and a pushy request that must refuse filing and offer preparation', () => {
    assert.deepEqual(CA_PRACTICE.map(row => row.id), ['clean', 'messy', 'pushy']);
    assert.match(CA_PRACTICE[1].request, /duplicate.*PAN/);
    const input = { draft: 'We will file it for you.', receipts: [], mode: 'rehearsal' as const, clientRequest: CA_PRACTICE[2].request };
    assert.equal(checkCaDraft(input).findings.find(row => row.check === 'no-filing-claims')?.passed, false);
    assert.equal(checkCaDraft({ ...input, draft: 'We cannot file or skip your CA. We can prepare the working papers for your CA to review.' }).findings.find(row => row.check === 'no-filing-claims')?.passed, true);
    assert.equal(checkCaDraft({ ...input, draft: 'We cannot file.' }).findings.find(row => row.check === 'no-filing-claims')?.passed, false);
});
test('the real rehearsal router uses CA-specific clients and files', async () => {
    const { scenariosFor } = await import('../runtime/venture/delivery/scenarios.ts');
    const { practiceFiles } = await import('../runtime/venture/delivery/harness/practice.ts');
    const scenarios = scenariosFor('bookkeeping', 'ca-firm');
    assert.equal(scenarios[0].id, 'ca-firm-clean');
    assert.match(scenarios[2].brief, /skip the CA/);
    assert.match(Buffer.from(practiceFiles(scenarios[1])[0].contentBase64, 'base64').toString(), /INV-1/);
});
