// P3-ca-firm: the playbook as data. Registered and pickable, with its human label; offers gated on a CA of record;
// typed steps the engine's validator accepts; approvals, honest connector labels, hard lines, the CA's duties; and
// the final diff against the portal's own file before the CA files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYBOOK_REGISTRY, pickPlaybook, playbookLabel, validateRegistry } from '../runtime/venture/playbooks/registry.ts';
import {
  CA_APPROVALS, CA_CONNECTORS, CA_DUTIES, CA_FIRM_LABEL, CA_FIRM_REGISTRATION, CA_HARD_LINES, CA_OFFERS, CA_ROLES, CA_STEPS,
  caFirmPlaybook, caFirmPlaybookSteps, caPlaybookStrings, diffAgainstPortal, offersFor, portalDiffReady, validateCaOfRecord,
} from '../runtime/venture/playbooks/ca-firm/index.ts';
import { RENUMBERING_QUESTION } from '../runtime/venture/playbooks/ca-firm/rates.ts';
import { validatePlaybook } from '../runtime/venture/delivery/playbook.ts';
import { toolSpec } from '../runtime/venture/delivery/harness/tools.ts';
import { doneClaimFindings, houseStyleFindings } from '../runtime/venture/records.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const CA = { name: 'CA Asha Rao', membershipNumber: '123456', firmName: 'Rao and Associates', firmRegistrationNumber: '012345W' };

test('registry: the CA firm is picked for its phrases and shows its human label, extending bookkeeping', () => {
  validateRegistry();
  assert.ok(PLAYBOOK_REGISTRY.includes(CA_FIRM_REGISTRATION));
  for (const idea of ['An AI-native CA firm for startups', 'A bookkeeping practice in Pune', 'GST filing service for shops', 'ITR filing for salaried people']) {
    assert.equal(pickPlaybook(idea)?.id, 'ca-firm', idea);
  }
  assert.equal(pickPlaybook('Monthly bookkeeping for cafes and small shops in Pune.'), null);
  assert.equal(playbookLabel('ca-firm'), 'AI-native CA firm');
  assert.equal(CA_FIRM_REGISTRATION.label, CA_FIRM_LABEL);
  assert.equal(CA_FIRM_REGISTRATION.serviceType, 'bookkeeping');
  assert.equal(caFirmPlaybook().label, 'AI-native CA firm');
});

test('offers: monthly books need no CA; regulated offers wait for a CA of record; audit and notices stay with the CA', () => {
  assert.deepEqual(CA_OFFERS.map(offer => [offer.id, offer.regulated, offer.caOnly]), [
    ['monthly-books', false, false], ['gst-working', true, false], ['itr-salaried', true, false], ['itr-small-business', true, false],
    ['tds-working', true, false], ['audit-support', true, true], ['notice-replies', true, true], ['itr-form-and-regime', true, false], ['itr-computation-only', true, false], ['itr-check-draft', true, false], ['itr-checklist', true, false], ['check-return-elsewhere', true, false], ['advance-tax-freelancer', true, false], ['tax-question-desk', true, false],
  ]);
  const without = offersFor(null);
  assert.deepEqual(without.filter(item => item.available).map(item => item.offer.id), ['monthly-books']);
  assert.match(without.find(item => item.offer.id === 'gst-working')!.reason!, /CA of record/);
  const withCa = offersFor(validateCaOfRecord(CA));
  assert.deepEqual(withCa.filter(item => item.available).map(item => item.offer.id), ['monthly-books', 'gst-working', 'itr-salaried', 'itr-small-business', 'tds-working', 'audit-support', 'notice-replies', 'itr-form-and-regime', 'itr-computation-only', 'itr-check-draft', 'itr-checklist', 'check-return-elsewhere', 'advance-tax-freelancer', 'tax-question-desk']);
  assert.match(withCa.find(item => item.offer.id === 'notice-replies')!.reason!, /only gather/);
  for (const offer of CA_OFFERS.filter(item => item.regulated)) assert.ok(offer.filedBy && !/chausar|agent/i.test(offer.filedBy), offer.id);
});

test('CA of record: a name and a six-digit ICAI membership number', () => {
  assert.deepEqual(validateCaOfRecord({ name: ' CA  Asha Rao ', membershipNumber: '123456' }), { name: 'CA Asha Rao', membershipNumber: '123456', firmName: null, firmRegistrationNumber: null });
  assert.throws(() => validateCaOfRecord({ name: 'CA Asha Rao', membershipNumber: '12345' }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => validateCaOfRecord({ name: '', membershipNumber: '123456' }), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => validateCaOfRecord({ name: 'CA Asha Rao', membershipNumber: '123456', firmRegistrationNumber: 'no' }), code('INVALID_VENTURE_REQUEST'));
});

test('steps: typed, with roles, and accepted by the engine\'s playbook validator', () => {
  assert.deepEqual(CA_STEPS.map(step => [step.id, step.kind, step.role.kind]), [
    ['gather', 'gather', 'agent'], ['clarify', 'question', 'agent'], ['reconcile', 'work', 'agent'], ['compute', 'work', 'agent'],
    ['draft', 'write', 'agent'], ['verify', 'verify', 'code'], ['approve', 'approve', 'owner'], ['ca-signoff', 'approve', 'ca'],
    ['portal-diff', 'compute', 'code'], ['file', 'operator', 'human'],
  ]);
  const steps = caFirmPlaybookSteps();
  const { validated } = validatePlaybook(steps);
  assert.equal(validated, true);
  for (const step of steps) for (const tool of step.tools ?? []) assert.notEqual(toolSpec(tool)!.effect, 'outside-write', `${step.id} ${tool}`);
  assert.equal(CA_STEPS.find(step => step.id === 'ca-signoff')!.gate, 'ca-signs-regulated');
  assert.ok(CA_STEPS.find(step => step.id === 'file')!.floor);
  assert.ok(CA_ROLES.some(role => role.id === 'auditor' && /read-only/i.test(role.job)));
});

test('approvals, connectors, hard lines and the CA\'s duties say what the code does and nothing more', () => {
  assert.deepEqual(CA_APPROVALS.map(item => item.id), ['owner-approves-draft', 'ca-signs-regulated', 'ca-confirms-rates', 'ca-accepts-portal-diff', 'human-files']);
  for (const id of ['income-tax-portal', 'gst-portal', 'traces']) {
    const connector = CA_CONNECTORS.find(item => item.id === id)!;
    assert.deepEqual(connector.modes.map(mode => [mode.mode, mode.status]), [['handoff', 'planned']], id);
  }
  // No connector writes to a government portal, now or planned.
  for (const connector of CA_CONNECTORS) if (/portal|traces/.test(connector.id)) assert.ok(!connector.modes.some(mode => mode.mode === 'write'));
  assert.ok(CA_HARD_LINES.some(line => /never file, sign or log in/i.test(line)));
  assert.ok(CA_DUTIES.some(line => /membership number/i.test(line)));
  assert.ok(caFirmPlaybook().openQuestions.includes(RENUMBERING_QUESTION));
  for (const words of caPlaybookStrings()) {
    assert.deepEqual(houseStyleFindings(words), [], words);
    assert.deepEqual(doneClaimFindings(words), [], words);
  }
});

test('portal diff: every difference between the portal\'s own file and the receipts is listed, and filing waits until each is explained', () => {
  const diff = diffAgainstPortal({
    ours: [
      { key: 'total-income', label: 'Total income', minor: '142500000', receiptId: 'ca_aaaaaaaaaaaaaaaaaaaaaaaa' },
      { key: 'tax-liability', label: 'Tax liability', minor: '9750000', receiptId: 'ca_aaaaaaaaaaaaaaaaaaaaaaaa' },
      { key: 'tds', label: 'TDS', minor: '9000000', receiptId: 'ca_bbbbbbbbbbbbbbbbbbbbbbbb' },
    ],
    portal: [{ key: 'total-income', minor: '142500000' }, { key: 'tax-liability', minor: '9760000' }, { key: 'refund', minor: '0' }],
  });
  assert.deepEqual(diff.rows.map(row => [row.key, row.state, row.deltaMinor]), [
    ['refund', 'only-on-portal', '0'], ['tax-liability', 'differs', '10000'], ['tds', 'missing-on-portal', '-9000000'], ['total-income', 'same', '0'],
  ]);
  assert.equal(diff.clean, false);
  assert.equal(portalDiffReady(diff, {}).ready, false);
  const partly = portalDiffReady(diff, { 'tax-liability': 'Utility rounds cess differently; accepted.' });
  assert.deepEqual(partly.unexplained, ['refund', 'tds']);
  const ready = portalDiffReady(diff, { 'tax-liability': 'Rounding.', tds: 'TDS shown on another schedule.', refund: 'No refund field in our working.' });
  assert.equal(ready.ready, true);
});
