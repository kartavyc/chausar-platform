// Chausar 5B1 regression tests. Tomada (AGPL, ideas only), Kimo (MIT), FilmCraft (MIT/Apache-2.0); original tests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanTranscript, applyCleanupCuts } from '../runtime/venture/playbooks/youtube/clean.ts';
import type { EditDocument } from '../runtime/venture/playbooks/youtube/edit-ops.ts';
const document: EditDocument = { durationMs: 60000, words: [
  { id: 'w1', text: 'Hello', startMs: 1000, endMs: 2000 }, { id: 'w2', text: 'um', startMs: 2500, endMs: 2700 },
  { id: 'w3', text: 'friend', startMs: 4000, endMs: 5000 }, { id: 'w4', text: 'like', startMs: 7000, endMs: 7200 },
], cuts: [], settings: {} };
const quiet = [{ startMs: 2000, endMs: 2500 }, { startMs: 2700, endMs: 4000 }, { startMs: 8000, endMs: 11000 }];
const input = () => ({ document, micQuiet: quiet, systemQuiet: quiet, vadQuiet: quiet, loudness: quiet.map(gap => ({ ...gap, db: -60 })), vertical: false });
test('cleanup uses measured air, suggests meaningful fillers and its preview is exactly the applied trim', () => {
  const result = cleanTranscript(input());
  assert.ok(result.cuts.some(cut => cut.reason === 'hesitation'));
  assert.ok(result.suggestions.some(item => item.wordIds.includes('w4')));
  assert.deepEqual(applyCleanupCuts(document, result.cuts), result.document);
  assert.equal(result.removedMs, result.cuts.reduce((sum, cut) => sum + cut.endMs - cut.startMs, 0));
  const hesitation = result.cuts.find(cut => cut.reason === 'hesitation')!;
  assert.ok(2500 - hesitation.startMs >= 30 && 2500 - hesitation.startMs <= 200);
  assert.ok(hesitation.endMs - 2700 >= 30 && hesitation.endMs - 2700 <= 200);
});
test('no measured quiet, one disagreeing channel or loud audio means no automatic silence cut', () => {
  assert.equal(cleanTranscript({ ...input(), micQuiet: [] }).cuts.length, 0);
  assert.equal(cleanTranscript({ ...input(), systemQuiet: [] }).cuts.length, 0);
  assert.equal(cleanTranscript({ ...input(), loudness: quiet.map(gap => ({ ...gap, db: -5 })) }).cuts.length, 0);
});
test('manual cuts survive cleanup and trims move word times without a fresh transcript', () => {
  const manual = { from: 'w3', to: 'w3', startMs: 4000, endMs: 5000, manual: true };
  const result = cleanTranscript({ ...input(), document: { ...document, cuts: [manual] } });
  assert.ok(result.document.cuts.some(cut => cut.manual && cut.from === 'w3'));
  assert.ok(result.timelineWords.find(word => word.id === 'w4')!.startMs < 7000);
  assert.throws(() => cleanTranscript({ ...input(), sources: [{ fps: '25', colour: 'bt709' }, { fps: '30', colour: 'bt709' }] }), { code: 'SOURCE_MISMATCH' });
});

test('cleanup enforces the seam limit in every rolling minute, even in a longer video', () => {
  const words = Array.from({ length: 10 }, (_, index) => [
    { id: `um${index}`, text: 'um', startMs: index * 6000 + 1000, endMs: index * 6000 + 1200 },
    { id: `speech${index}`, text: 'meaningful', startMs: index * 6000 + 2000, endMs: index * 6000 + 4000 },
  ]).flat();
  const gaps = words.filter(word => word.text === 'um').flatMap(word => [{ startMs: word.startMs - 150, endMs: word.startMs }, { startMs: word.endMs, endMs: word.endMs + 150 }]);
  const result = cleanTranscript({ document: { durationMs: 120000, words, cuts: [], settings: {} }, micQuiet: gaps, systemQuiet: gaps, vadQuiet: gaps, loudness: gaps.map(gap => ({ ...gap, db: -60 })) });
  assert.equal(result.cuts.length, 6);
});

test('measured programme edges open just before speech and keep at most eight tenths at the tail', () => {
  const words = [{ id: 'w1', text: 'Hello', startMs: 2000, endMs: 4000 }, { id: 'w2', text: 'friend', startMs: 4000, endMs: 6000 }];
  const quiet = [{ startMs: 0, endMs: 2000 }, { startMs: 6000, endMs: 10000 }];
  const made = cleanTranscript({ document: { durationMs: 10000, words, cuts: [], settings: {} }, micQuiet: quiet, systemQuiet: quiet, vadQuiet: quiet, loudness: quiet.map(span => ({ ...span, db: -60 })) });
  assert.deepEqual(made.cuts.map(cut => [cut.startMs, cut.endMs]), [[0, 1900], [6800, 10000]]);
  assert.equal(made.timelineWords[0].startMs, 100);
});


test('cleanup counts saved cuts when preserving speech and the rolling seam budget', () => {
  const short = { ...document, words: [{id:'a',text:'Hello',startMs:1000,endMs:1900}, {id:'b',text:'um',startMs:2500,endMs:2700}], cuts:[{from:'a',to:'a',startMs:0,endMs:1000,manual:true}] };
  assert.equal(cleanTranscript({...input(),document:short}).cuts.length,0);
  const saved = Array.from({length:6},(_,i)=>({from:'w1',to:'w1',startMs:10000+i*4000,endMs:11000+i*4000,manual:true}));
  const result = cleanTranscript({...input(),document:{...document,cuts:saved}});
  assert.equal(result.cuts.length,0);
  assert.deepEqual(result.document.cuts,saved);
});

test('overlapping duplicate quiet measurements do not multiply intersection work', () => {
  let reads = 0;
  const spans = Array.from({ length: 12 }, () => ({ get startMs() { reads++; return 2000; }, get endMs() { reads++; return 2500; }, db: -60 }));
  cleanTranscript({ ...input(), micQuiet: spans, systemQuiet: spans, vadQuiet: spans, loudness: spans });
  assert.ok(reads < 6000, `bounded input measurements were read ${reads} times`);
});
