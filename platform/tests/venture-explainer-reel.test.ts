// Original quote-only storyboard boundary. reels-af workflow idea, no source code reused.
import test from 'node:test';import assert from 'node:assert/strict';
import {explainerQuotes} from '../runtime/venture/playbooks/narration-studio/explainer.ts';
test('every explainer line is an exact source span and carries disclosure',()=>{const text='First quoted line. Second source claim.';const result=explainerQuotes(text,[{start:0,end:18,text:'First quoted line.'}]);assert.equal(result.lines[0].text,'First quoted line.');assert.equal(result.disclosure,'AI narration');assert.ok(result.sourceDigest);});
test('invented, empty, overlapping, altered or out-of-bounds quote spans refuse',()=>{for(const lines of [[{start:0,end:4,text:'fake'}],[{start:-1,end:4,text:'real'}],[],[{start:0,end:4,text:'real'},{start:0,end:4,text:'real'}]])assert.throws(()=>explainerQuotes('real source',lines),{code:'EXPLAINER_QUOTE_REQUIRED'});});
