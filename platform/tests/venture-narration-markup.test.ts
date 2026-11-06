// Original Chausar tests. LocalText2Voice MIT markup ideas, no implementation copied.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNarrationMarkup} from '../runtime/venture/playbooks/narration-studio/markup.ts';
const voices=[{id:'hi-stock',language:'hi-IN',licence:'Provider commercial terms'},{id:'en-stock',language:'en-IN',licence:'Provider commercial terms'}];
const options={voices,voice:'hi-stock',language:'hi-IN',requestRevision:'google-v1',providerModelRevision:null,maxBytes:80};
test('markup resolves voice, language and pauses without speaking directives',()=>{
 const rows=parseNarrationMarkup('नमस्ते। {{pause 700}} {{voice "en-stock"}}{{lang en-IN}}Hello world.',options);
 assert.equal(rows.length,2);assert.equal(rows[0].text,'नमस्ते।');assert.equal(rows[0].pauseAfterMs,700);assert.equal(rows[1].voice,'en-stock');assert.equal(rows[1].language,'en-IN');assert.equal(rows[1].requestRevision,'google-v1');assert.equal(rows[1].providerModelRevision,null);assert.equal(rows[1].timing,'unconfirmed');
});
test('unknown directives, unlicensed voices and invalid combinations refuse',()=>{
 for(const text of ['{{voice "missing"}}Hello','{{lang xx}}Hello','{{emotion happy}}Hello','{{pause -1}}Hello','{{pause 7001}}Hello','{{voice "en-stock"}}Hello','broken {{voice'])assert.throws(()=>parseNarrationMarkup(text,options),{code:'NARRATION_MARKUP_INVALID'});
 assert.throws(()=>parseNarrationMarkup('Hello',{...options,voices:[{...voices[0],licence:''}]}),{code:'CONSENT_REQUIRED'});
});
test('splitting is bounded in UTF8 bytes, keeps every word and stable source identity',()=>{
 const source='यह एक अच्छा पाठ है। '.repeat(40);const rows=parseNarrationMarkup(source,options);
 assert.ok(rows.length>2);assert.ok(rows.every(row=>new TextEncoder().encode(row.text).length<=80));
 assert.equal(rows.map(row=>row.text).join(' '),source.trim());assert.deepEqual(parseNarrationMarkup(source,options),rows);
 assert.notEqual(parseNarrationMarkup(source.replace('अच्छा','लंबा'),options)[0].id,rows[0].id);
 assert.throws(()=>parseNarrationMarkup('क'.repeat(81),options),{code:'NARRATION_MARKUP_INVALID'});
});
test('reset restores explicit defaults and markup-only input cannot become a paid call',()=>{
 const rows=parseNarrationMarkup('{{voice "en-stock"}}{{lang en-IN}}Hello. {{reset}}नमस्ते।',options);assert.equal(rows[1].voice,'hi-stock');assert.equal(rows[1].language,'hi-IN');
 assert.throws(()=>parseNarrationMarkup('{{pause 100}}',options),{code:'NARRATION_MARKUP_INVALID'});
});
