// Original R2 regressions. Synthetic records only; no website or client account is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedFormSite } from '../runtime/venture/playbooks/data-entry-desk/deny.ts';
import { mapFormRecord, formActionGate } from '../runtime/venture/playbooks/data-entry-desk/mapping.ts';
import { compareFormReadback } from '../runtime/venture/playbooks/data-entry-desk/readback.ts';

const permission={origin:'https://records.example.com',allowed:true,revocableStaffLogin:true};
const page='a'.repeat(64);
const target={id:'target_name',fingerprint:'b'.repeat(64),pageHash:page,name:'Client name',kind:'text',disabled:false,inForm:true};

test('R2 site approval is exact and never admits forbidden sites or coercible approvals',()=>{
 assert.equal(approvedFormSite('https://records.example.com/new',permission).origin,permission.origin);
 for(const url of ['https://service.gov.in/new','https://x.nic.in','https://sellercentral.amazon.in','https://sellercentral.amazon.com','https://seller.flipkart.com','https://supplier.meesho.com','https://seller.meesho.com','https://records.example.com.evil.test','https://127.0.0.1','https://[::1]','https://user:pass@records.example.com','file:///C:/record'])assert.throws(()=>approvedFormSite(url,{...permission,origin:new URL(url).origin}),{code:'SITE_NOT_ALLOWED'},url);
 assert.throws(()=>approvedFormSite('https://different.example.com',permission),{code:'SITE_NOT_ALLOWED'});
 assert.throws(()=>approvedFormSite(permission.origin,{...permission,allowed:['true']}),{code:'SITE_NOT_ALLOWED'});
 assert.throws(()=>approvedFormSite(permission.origin,{...permission,revocableStaffLogin:false}),{code:'SITE_NOT_ALLOWED'});
});

test('R2 mapping preserves exact source strings and binds unique current snapshot targets',()=>{
 const input={source:{Name:'Asha',Account:'00XX0042'},fields:[target,{...target,id:'target_account',name:'Masked account',fingerprint:'c'.repeat(64)}],mapping:[{column:'Name',targetId:target.id},{column:'Account',targetId:'target_account'}],pageHash:page};
 const result=mapFormRecord(input);
 assert.deepEqual(result.map(row=>row.value),['Asha','00XX0042']);
 assert.equal(result[0].fingerprint,target.fingerprint);
 assert.throws(()=>mapFormRecord({...input,mapping:[...input.mapping,input.mapping[0]]}),{code:'FORM_MAPPING_INVALID'});
 assert.throws(()=>mapFormRecord({...input,pageHash:'d'.repeat(64)}),{code:'FORM_TARGET_CHANGED'});
 assert.throws(()=>mapFormRecord({...input,fields:[{...target,kind:'password'},input.fields[1]]}),{code:'FORM_ACTION_HELD'});
 assert.throws(()=>mapFormRecord({...input,mapping:[{column:'Not supplied',targetId:target.id}]}),{code:'FORM_MAPPING_INVALID'});
});

test('R2 action gate holds all submits, Enter in forms and button roles, and never types secrets',()=>{
 assert.equal(formActionGate({target,action:'type'}),'fill');
 for(const kind of ['submit','button','role-button','password','file','download','unknown'])assert.equal(formActionGate({target:{...target,kind},action:'click'}),'hold',kind);
 assert.equal(formActionGate({target,action:'enter'}),'hold');
 assert.equal(formActionGate({target:{...target,disabled:true},action:'type'}),'hold');
 assert.equal(formActionGate({target:{...target,name:'One time passcode'},action:'type'}),'hold');
 assert.equal(formActionGate({target:{...target,kind:'link'},action:'click'}),'hold');
});

test('R2 readback compares exact values and never reports success without a saved record identity',()=>{
 const expected=[{targetId:'name',value:'Asha'},{targetId:'code',value:'0012'}];
 assert.equal(compareFormReadback(expected,{recordId:'record-1',fields:{name:'Asha',code:'0012'}}).status,'matches');
 assert.deepEqual(compareFormReadback(expected,{recordId:'record-1',fields:{name:'Asha',code:'12'}}),{status:'saved-differently',recordId:'record-1',differences:[{targetId:'code',expected:'0012',actual:'12'}]});
 assert.equal(compareFormReadback(expected,{recordId:null,fields:{name:'Asha',code:'0012'}}).status,'not-checked');
 assert.deepEqual(compareFormReadback(expected,{recordId:'record-1',fields:{name:'Asha'}}).differences,[{targetId:'code',expected:'0012',actual:null}]);
});
