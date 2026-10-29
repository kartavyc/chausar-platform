import test from 'node:test';
import assert from 'node:assert/strict';
import {digest} from '../runtime/portable.ts';
import {proposeCareerFact,approveCareerFact,currentCareerFacts} from '../runtime/venture/playbooks/job-search-desk/state.ts';
const value={id:'fact-1',statement:'Interviewed customers',qualifiers:['during an internship'],forbiddenUses:['employment as manager']};
test('new claims and relaxed boundaries wait for exact proposal approval',()=>{
 const proposed=proposeCareerFact(null,value);
 assert.equal(proposed.approved,null);assert.deepEqual(proposed.proposal,value);
 assert.deepEqual(currentCareerFacts([proposed]),[]);
 assert.throws(()=>approveCareerFact(proposed,digest(value)),{code:'APPROVAL_STALE'});
 const approved=approveCareerFact(proposed,digest(proposed));
 assert.deepEqual(currentCareerFacts([approved]),[value]);
 const relaxed=proposeCareerFact(approved,{...value,qualifiers:[]});
 assert.deepEqual(currentCareerFacts([relaxed]),[value]);
 assert.throws(()=>approveCareerFact(relaxed,digest(approved)),{code:'APPROVAL_STALE'});
 assert.deepEqual(currentCareerFacts([approveCareerFact(relaxed,digest(relaxed))])[0].qualifiers,[]);
});
test('agent tightening preserves the statement, invalidates old content bindings and never approves pending new claims',()=>{
 const first=proposeCareerFact(null,value),approved=approveCareerFact(first,digest(first));
 const tight=proposeCareerFact(approved,{...value,forbiddenUses:[...value.forbiddenUses,'executive leadership']});
 assert.equal(tight.proposal,null);assert.notEqual(digest(currentCareerFacts([tight])),digest(currentCareerFacts([approved])));
 const invented=proposeCareerFact(tight,{...value,statement:'Managed a company'});
 assert.equal(currentCareerFacts([invented])[0].statement,value.statement);
 assert.throws(()=>proposeCareerFact(approved,{...value,id:'another'}));
});
