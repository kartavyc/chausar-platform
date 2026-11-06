// Chausar 5B1 regression tests. Tomada (AGPL, ideas only), Kimo (MIT), FilmCraft (MIT/Apache-2.0); original tests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEditOps, editDigest, undoEdit, type EditDocument } from '../runtime/venture/playbooks/youtube/edit-ops.ts';

// 5B1, Tomada's AGPL ideas only. Worked examples test the public edit transaction.
const doc = (): EditDocument => ({ durationMs: 10000, words: [
  { id: 'w1', text: 'Keep', startMs: 0, endMs: 1000 },
  { id: 'w2', text: 'this', startMs: 1000, endMs: 2000 },
  { id: 'w3', text: 'meaning', startMs: 2000, endMs: 3000 },
], cuts: [], settings: {} });
test('one request keeps successful operations, refuses a bad operation whole and undoes together', () => {
  const before = doc();
  const result = applyEditOps(before, [{ kind: 'cut', from: 'w1', to: 'w1' }, { kind: 'cut', from: 'missing', to: 'w2' }, { kind: 'title', text: 'The meaning' }]);
  assert.equal(result.applied.length, 2);
  assert.equal(result.refused[0].code, 'EDIT_WORD_UNKNOWN');
  assert.equal(result.removedMs, 1000);
  assert.equal(result.summary, 'Cut 1 passage, 1 s shorter.');
  assert.deepEqual(undoEdit(result), before);
  assert.equal(before.cuts.length, 0);
});
test('a cut over a fifth needs confirmation for the exact current document', () => {
  const before = doc();
  const ops = [{ kind: 'cut', from: 'w1', to: 'w3' }] as const;
  assert.throws(() => applyEditOps(before, ops), { code: 'EDIT_ASK_AGAIN' });
  assert.equal(applyEditOps(before, ops, { confirmedDigest: editDigest(before) }).removedMs, 3000);
  assert.throws(() => applyEditOps({ ...before, settings: { title: 'Changed' } }, ops, { confirmedDigest: editDigest(before) }), { code: 'EDIT_STALE' });
});
test('overlaps and restoring uncut ranges refuse; the operation cap refuses the request', () => {
  const first = applyEditOps(doc(), [{ kind: 'cut', from: 'w1', to: 'w1' }]);
  assert.equal(applyEditOps(first.document, [{ kind: 'cut', from: 'w1', to: 'w2' }]).refused[0].code, 'EDIT_CUT_OVERLAP');
  assert.equal(applyEditOps(first.document, [{ kind: 'restore', from: 'w2', to: 'w2' }]).refused[0].code, 'EDIT_NOT_CUT');
  assert.equal(applyEditOps(first.document, [{ kind: 'restore', from: 'w1', to: 'w1' }]).document.cuts.length, 0);
  assert.throws(() => applyEditOps(doc(), Array.from({ length: 41 }, () => ({ kind: 'title' as const, text: 'Title' }))), { code: 'EDIT_TOO_MANY' });
});
test('typed visual, clipping and caption operations reject invented words and invalid values', () => {
  const result = applyEditOps(doc(), [
    { kind: 'zoom', from: 'w1', to: 'w2', scale: 1.5 }, { kind: 'layout', value: 'vertical' },
    { kind: 'clip', from: 'w2', to: 'w3' }, { kind: 'captions', profile: 'web' }, { kind: 'hook', from: 'w1', to: 'w2' },
  ]);
  assert.equal(result.applied.length, 5);
  assert.deepEqual(result.document.settings.hook, { from: 'w1', to: 'w2' });
  assert.equal(applyEditOps(doc(), [{ kind: 'zoom', from: 'w1', to: 'w2', scale: 100 }]).refused[0].code, 'EDIT_INVALID');
});

test('unknown operation fields are refused whole and malformed saved words never enter the editor', () => {
  const out = applyEditOps(doc(), [{ kind: 'title', text: 'Title', hidden: 'publish now' } as never]);
  assert.equal(out.refused[0].code, 'EDIT_INVALID');
  assert.equal(out.document.settings.title, undefined);
  assert.throws(() => applyEditOps({ ...doc(), words: [{ id: 'same', text: 'a', startMs: 0, endMs: 2000 }, { id: 'same', text: 'b', startMs: 2000, endMs: 3000 }] }, []), { code: 'EDIT_INVALID' });
});


test('restoring a fully cut subrange restores just those words and preserves the cuts around it', () => {
  const before = doc();
  const cut = applyEditOps(before, [{ kind: 'cut', from: 'w1', to: 'w3' }], { confirmedDigest: editDigest(before) });
  const restored = applyEditOps(cut.document, [{ kind: 'restore', from: 'w2', to: 'w2' }]);
  assert.equal(restored.refused.length, 0);
  assert.deepEqual(restored.document.cuts.map(item => [item.startMs, item.endMs]), [[0, 1000], [2000, 3000]]);
  assert.equal(restored.removedMs, 2000);
});

test('negative measured word and saved cut times are refused', async () => {
  const {wordSource}=await import('../runtime/venture/playbooks/youtube/source.ts');
  assert.throws(()=>wordSource({label:'negative',durationMs:1000,words:[{id:'a',text:'negative',startMs:-1,endMs:200}]}),{code:'EDIT_INVALID'});
  assert.throws(()=>applyEditOps({...doc(),cuts:[{from:'w1',to:'w1',startMs:-1,endMs:200}]},[]),{code:'EDIT_INVALID'});
});

test('the second ask reports the new removal, separately from cuts already saved', () => {
  const document: EditDocument = { durationMs: 10000, words: [{ id: 'old', text: 'old', startMs: 0, endMs: 1000 }, { id: 'new', text: 'new', startMs: 2000, endMs: 5000 }], cuts: [{ from: 'old', to: 'old', startMs: 0, endMs: 1000, manual: true }], settings: {} };
  const result = applyEditOps(document, [{ kind: 'cut', from: 'new', to: 'new' }], { confirmedDigest: editDigest(document) });
  assert.equal(result.addedPercent, 30);
  assert.equal(result.addedShare, 0.3);
  assert.equal(result.addedMs, 3000);
});
