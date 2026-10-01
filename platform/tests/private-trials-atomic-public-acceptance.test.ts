import test from 'node:test';
import assert from 'node:assert/strict';
import { Vault } from '../runtime/vault.ts';
import { fixture, selectSavedAnswers, assertUnchangedAuthority, historicalReceiptContent } from './fixtures/private-trials-public-acceptance.ts';

// Verify the names and storage API against the frozen public join before running.
// All trial operations and the competing correction use actual preload/strict IPC.
// Hooks retain real encrypted custody and the actual Vault transaction draft.
test('public trial publication rechecks a real source correction inside its actual Vault commit transaction', async t => {
  const f = await fixture(t), savedAnswerIds = await selectSavedAnswers(f);
  const created = await f.request('trials.create', { version: 1, savedAnswerIds, change: f.change });
  const evaluated = await f.request('trials.evaluate', { trialId: created.trialId });
  assert.ok(evaluated.evaluation); assert.equal(evaluated.evaluationDigest, evaluated.evaluation.digest);
  const impact = await f.request('trials.impact', { trialId: created.trialId, strategy: 'prospective' });
  assert.equal(impact.complete, true); assert.equal(impact.evaluationDigest, evaluated.evaluationDigest);
  const before = await f.evidence(), invoice = before.facts.facts.find((fact: any) => fact.entityId === 'huge');
  assert.ok(invoice); assert.equal(invoice.fields.amountMinor, '900719925474099325');

  // The module-only preparation base does not yet declare the joined custody API.
  const prototype = Vault.prototype as any, writeArtifact = prototype.writeArtifact, update = prototype.update;
  assert.equal(typeof writeArtifact, 'function', 'The frozen host must supply actual Vault encrypted artifact custody.');
  assert.equal(typeof update, 'function');
  let reservationEntered = 0, reservationDiskBytes = 0, updateEntries = 0;
  let interposed = false, publicationCallbackEntered = false;
  let corrected: Awaited<ReturnType<typeof f.evidence>> | undefined;
  const reservationHook = t.mock.method(prototype, 'writeArtifact', async function (this: Vault, input: any) {
    const realRef = await writeArtifact.call(this, input);
    assert.equal(input.purpose, 'private-trial'); assert.equal(input.value.status, 'promoting');
    assert.equal(input.value.trialId, created.trialId); reservationEntered++;
    assert.equal(realRef.id, input.id); assert.equal(realRef.purpose, 'private-trial');
    assert.match(realRef.valueDigest, /^[a-f0-9]{64}$/); assert.ok(realRef.diskBytes > 0);
    reservationDiskBytes = realRef.diskBytes;
    return realRef;
  }, { times: 1 });
  t.mock.method(prototype, 'update', async function (this: Vault, change: any) {
    updateEntries++;
    if (interposed) return update.call(this, change);
    interposed = true; assert.equal(reservationEntered, 1);
    // No queue is held here: the actual competing public correction commits first.
    f.advance(1000);
    await f.request('memory.correct', { id: invoice.id, fields: { amountMinor: '900719925474099326' } });
    corrected = await f.evidence();
    assert.equal(corrected.facts.facts.find((fact: any) => fact.entityId === 'huge').fields.amountMinor, '900719925474099326');
    assert.deepEqual(corrected.ontology, before.ontology); assert.deepEqual(corrected.imports, before.imports);
    assert.deepEqual(corrected.receipts.map(historicalReceiptContent), f.receipts.map(historicalReceiptContent),
      'Source correction preserves historical receipt content while updating its explicit staleness metadata.');
    assert.ok(corrected.receipts.every(receipt => receipt.stale));
    return update.call(this, (actualDraft: any) => {
      publicationCallbackEntered = true;
      return change(actualDraft);
    });
  });

  await assert.rejects(f.request('trials.promote', { trialId: created.trialId,
    evaluationDigest: evaluated.evaluationDigest, strategy: 'prospective', acknowledgedImpactDigest: impact.digest }),
  { code: 'TRIAL_STALE_BASE' });
  assert.equal(reservationEntered, 1); assert.equal(reservationHook.mock.callCount(), 1); assert.ok(reservationDiskBytes > 0);
  assert.equal(interposed, true); assert.ok(updateEntries >= 2, 'The outer publication and real correction both reach actual Vault.update.');
  assert.equal(publicationCallbackEntered, true, 'The original Engine publication callback must enter with the actual corrected transaction draft.');
  assert.ok(corrected);
  await assertUnchangedAuthority(f, corrected);
  assert.equal((await f.request('ontology.get')).current.hash, f.dictionary.hash);
  const publications = (await f.request('activity.list')).items.filter((event: any) => event.event === 'private-trial.published'
    && event.details.trialId === created.trialId);
  assert.deepEqual(publications, []);
  t.diagnostic('Actual encrypted reservation, public correction and original Engine callback on the real Vault draft. A promoting reservation may remain after refusal; this case does not qualify reservation cleanup.');
});
