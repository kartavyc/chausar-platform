// Shared calculator leaves must retain native SHA-256 and approval canonicalization byte for byte.
import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {hash,canonical,digest,ChausarError} from '../runtime/portable.ts';
import {ChausarError as NativeError} from '../runtime/contracts.ts';
test('portable hashes equal native SHA-256 for Unicode, nested keys and tax receipt inputs',()=>{
 for(const value of ['', 'भारत ₹', {z:['a',1,null,true],a:{tax:'120001',ay:'2027-28'}},Array.from({length:600},(_,i)=>({i,text:'é'.repeat(i%20)}))]){assert.equal(hash(value),createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex'));assert.equal(digest(value),createHash('sha256').update(canonical(value)).digest('hex'));}
 assert.equal(digest({b:2,a:1}),digest({a:1,b:2}));assert.throws(()=>canonical({x:undefined}),{code:'INVALID_PAYLOAD'});assert.equal(new ChausarError('X','x') instanceof NativeError,true);
});
