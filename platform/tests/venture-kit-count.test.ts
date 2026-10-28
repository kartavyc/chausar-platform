// Harness integer controls never silently truncate or coerce money-like input.
import test from 'node:test';
import assert from 'node:assert/strict';
import {wholeCount} from '../runtime/venture/playbooks/kit/count.ts';
test('whole counts accept bounded integer text and reject fractions, suffixes and unsafe values',()=>{
 assert.equal(wholeCount('0'),0);assert.equal(wholeCount('004'),4);assert.equal(wholeCount(20),20);
 for(const input of ['',null,true,'4px','2.5',-1,'-1','9007199254740992',Infinity])assert.throws(()=>wholeCount(input),{code:'TOOL_FAILED'});
});
