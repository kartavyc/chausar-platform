import { FAKE_CA_RULES } from '../../app/ui/src/engine/fake-ca-rules.ts';
// The browser fixtures must keep the real rule register and starter offers exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CA_OFFERS } from '../runtime/venture/playbooks/ca-firm/playbook.ts';
import { caIntakeFields } from '../runtime/venture/playbooks/ca-firm/intake-fields.ts';
import { flagshipPlanById } from '../runtime/venture/playbooks/plan.ts';
import { CITATION_TABLE, citationTableHash } from '../runtime/venture/playbooks/ca-firm/citations.ts';
test('CA sample onboarding and citation register remain field-exact with the real engine', async () => {
    const rows = JSON.parse(await readFile(new URL('../../app/ui/src/engine/fixtures-ca-plan.json', import.meta.url), 'utf8'));
    assert.deepEqual(rows, flagshipPlanById('ca-firm')!.offers.map(offer => ({ ...CA_OFFERS.find(row => row.id === offer.key), intake: caIntakeFields(offer.key) ?? null })));
    for (const offer of flagshipPlanById('ca-firm')!.offers) assert.deepEqual(offer.intake, caIntakeFields(offer.key), offer.key + ' must retain its actual owner intake');
    const { tableHash, ...fixture } = FAKE_CA_RULES;
    assert.equal(tableHash, citationTableHash());
    assert.deepEqual(fixture, CITATION_TABLE);
});
