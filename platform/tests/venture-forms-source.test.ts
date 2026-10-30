// Original source-only data entry regressions. Values are copied, never inferred or normalized.
import test from 'node:test';
import assert from 'node:assert/strict';
import {formSource,chooseFormRow} from '../runtime/venture/playbooks/data-entry-desk/source-core.ts';
test('R2 source rows preserve exact client values, leading zeros and masked identifiers',()=>{
 const source=formSource('Customer,Account,Note\r\nAsha,00XX0042,"one, two"\r\nDev,0007,"line1\nline2"\r\n');assert.deepEqual(source.columns,['Customer','Account','Note']);assert.deepEqual(source.rows[0],{Customer:'Asha',Account:'00XX0042',Note:'one, two'});assert.equal(source.rows[1].Account,'0007');assert.equal(source.rows[1].Note,'line1\nline2');assert.match(source.digest,/^[a-f0-9]{64}$/);
});
test('R2 ambiguous, secret and overlong source files are refused before any browser operation',()=>{
 for(const text of ['Customer,Customer\nA,B','Customer,\nA,B','__proto__,Customer\nx,A','Customer,Password\nA,secret','Customer,one-time-code\nA,0000','Customer\n'+ 'x'.repeat(4001),'Customer,Note\nA','Customer\n'])assert.throws(()=>formSource(text),{code:'FORM_SOURCE_INVALID'},text.slice(0,40));
});
test('R2 source identity is explicit, unique and stable across a new upload of the same record',()=>{
 const text='Record,Customer\n0001,Asha\n0002,Dev';const picked=chooseFormRow(text,'Record',1);assert.equal(picked.sourceRecordId,'0002');assert.deepEqual(picked.values,{Record:'0002',Customer:'Dev'});assert.equal(chooseFormRow(text,'Record',1).rowDigest,picked.rowDigest);for(const [source,column,index] of [[text,'Unknown',0],['Record,Customer\none,Asha\none,Dev','Record',0],['Record,Customer\n,Asha','Record',0],[text,'Record',2],[text,'Record',0.5]] as const)assert.throws(()=>chooseFormRow(source,column,index),{code:'FORM_SOURCE_INVALID'});
});
