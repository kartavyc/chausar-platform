// Shared transport regression: exact company fence and final physical-send approval.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createZohoTransport} from '../runtime/adapters/accounting/zoho-transport.ts';
import type {PinnedSender} from '../runtime/venture/core/net-guard.ts';
const config={dataCenter:'in' as const,organizationId:'12345',accessToken:'owner session token',revision:'one'},resolve=async()=>[{address:'93.184.216.34',family:4 as const}];
test('shared connection rejects coercible data centres',()=>{for(const dataCenter of [['in'],{toString:()=> 'in'}])assert.throws(()=>createZohoTransport({...config,dataCenter} as any),{code:'BOOKS_CONNECTION_INVALID'});});
test('shared Zoho transport fences paths and company and invokes approval after DNS before one send',async()=>{
 let sent=0,approved=0,dns=0;const send:PinnedSender=async target=>{sent++;assert.equal(approved,1);assert.equal(dns,1);assert.equal(target.url.hostname,'www.zohoapis.in');assert.equal(target.url.searchParams.get('organization_id'),'12345');return {status:201,headers:{},body:Buffer.from('{"code":0,"id":9007199254740993}')};};
 const transport=createZohoTransport(config,{resolve:async()=>{dns++;return resolve();},send});
 for(const path of ['https://evil.test/write','../contacts','contacts?organization_id=9'])await assert.rejects(transport.post(path,{},'{}',()=>{approved++;}));
 await assert.rejects(transport.post('contacts',{organization_id:'9'},'{}',()=>{approved++;}));assert.equal(sent,0);
 assert.equal((await transport.post('contacts',{},'{}',()=>{approved++;})).id,'9007199254740993');assert.equal(sent,1);
});
test('shared Zoho transport refuses wrong-company evidence, provider failure and post revocation without retry',async()=>{
 let sent=0;const send:PinnedSender=async()=>{sent++;return {status:200,headers:{},body:Buffer.from('{"code":0,"organization_id":"other"}')};};
 const transport=createZohoTransport(config,{resolve,send});await assert.rejects(transport.get('contacts'),{code:'BOOKS_READ_FAILED'});
 await assert.rejects(transport.post('contacts',{},'{}',()=>{throw Error('revoked');}),/revoked/);assert.equal(sent,1);
});
test('malformed provider JSON stays a read failure or unconfirmed write',async()=>{const send:PinnedSender=async()=>({status:200,headers:{},body:Buffer.from('{bad provider response')});const transport=createZohoTransport(config,{resolve,send});await assert.rejects(transport.get('contacts'),{code:'BOOKS_READ_FAILED'});await assert.rejects(transport.post('contacts',{},'{}',()=>{}),{code:'BOOKS_WRITE_UNCONFIRMED'});});
