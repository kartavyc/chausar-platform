// Original R2 physical webRequest boundary checks. No browser or external network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createRequestGate}=require('../../app/desktop/owner-browser-gate.cjs');
const origin='https://records.example.com';
const row=(extra:Record<string,unknown>={})=>({id:1,webContentsId:9,url:origin+'/save',method:'POST',resourceType:'mainFrame',uploadData:[{bytes:Buffer.from('customer=0007')}],...extra});
test('R2 request gate holds unsolicited submit, Enter, role-button requests and background effects',()=>{
 const gate=createRequestGate({origin,webContentsId:9,current:()=>true});
 for(const detail of [row(),row({method:'GET'}),row({resourceType:'xhr'}),row({resourceType:'ping'}),row({resourceType:'webSocket'}),row({url:'mailto:owner@example.com'})])assert.deepEqual(gate.beforeRequest(detail),{cancel:true});
 gate.armNavigation(origin+'/entry');assert.deepEqual(gate.beforeRequest(row({method:'GET',url:origin+'/entry',uploadData:undefined})),{cancel:false});assert.deepEqual(gate.beforeRequest(row({method:'GET',url:origin+'/entry',uploadData:undefined})),{cancel:true});
});
test('R2 exact submit authorization is consumed once and rechecked immediately before physical headers',()=>{
 let live=true;const gate=createRequestGate({origin,webContentsId:9,current:()=>live});
 gate.armSubmit({url:origin+'/save',body:'customer=0007',contentType:'application/x-www-form-urlencoded'});
 assert.deepEqual(gate.beforeRequest(row()),{cancel:false});assert.deepEqual(gate.beforeRequest(row({id:2})),{cancel:true});live=false;
 assert.deepEqual(gate.beforeSendHeaders(row({requestHeaders:{'Content-Type':'application/x-www-form-urlencoded'}})),{cancel:true});assert.equal(gate.outcome().sent,false);
});
test('R2 changed bytes, file uploads, origins and request types cannot spend an exact approval',()=>{
 for(const change of [{uploadData:[{bytes:Buffer.from('customer=0008')}]},{uploadData:[{file:'C:/private.csv'}]},{webContentsId:10},{url:'https://else.example.com/save'},{resourceType:'xhr'},{method:'GET'}]){const gate=createRequestGate({origin,webContentsId:9,current:()=>true});gate.armSubmit({url:origin+'/save',body:'customer=0007',contentType:'application/x-www-form-urlencoded'});assert.deepEqual(gate.beforeRequest(row(change)),{cancel:true});assert.equal(gate.outcome().sent,false);}
});
test('R2 saved evidence is only the matching successful server response and redirects are refused',()=>{
 const gate=createRequestGate({origin,webContentsId:9,current:()=>true});gate.armSubmit({url:origin+'/save',body:'customer=0007',contentType:'application/x-www-form-urlencoded'});gate.beforeRequest(row());assert.deepEqual(gate.beforeSendHeaders(row({requestHeaders:{'Content-Type':'application/x-www-form-urlencoded'}})),{cancel:false});assert.equal(gate.outcome().sent,true);assert.equal(gate.outcome().savedResponse,null);
 assert.deepEqual(gate.headersReceived(row({statusCode:302})),{cancel:true});assert.equal(gate.outcome().savedResponse,null);
 const second=createRequestGate({origin,webContentsId:9,current:()=>true});second.armSubmit({url:origin+'/save',body:'customer=0007',contentType:'application/x-www-form-urlencoded'});second.beforeRequest(row());second.beforeSendHeaders(row({requestHeaders:{'Content-Type':'application/x-www-form-urlencoded'}}));assert.deepEqual(second.headersReceived(row({id:99,statusCode:200})),{cancel:true});assert.deepEqual(second.headersReceived(row({statusCode:200})),{cancel:false});assert.equal(second.outcome().savedResponse,null);second.completed(row({statusCode:200}));assert.deepEqual(second.outcome().savedResponse,{requestId:1,url:origin+'/save',statusCode:200});
});
test('R2 permits only its private proxy challenge once, without treating authentication as a saved response',()=>{
 const realm='a'.repeat(32);const gate=createRequestGate({origin,webContentsId:9,current:()=>true,proxyRealm:realm});gate.armNavigation(origin+'/entry');const request=row({url:origin+'/entry',method:'GET',uploadData:undefined});gate.beforeRequest(request);gate.beforeSendHeaders(request);assert.deepEqual(gate.headersReceived({...request,statusCode:407,responseHeaders:{'Proxy-Authenticate':[`Basic realm="${realm}"`]}}),{cancel:false});assert.equal(gate.outcome().savedResponse,null);assert.deepEqual(gate.beforeSendHeaders(request),{cancel:false});assert.deepEqual(gate.headersReceived({...request,statusCode:407,responseHeaders:{'Proxy-Authenticate':[`Basic realm="${realm}"`]}}),{cancel:true});
 const other=createRequestGate({origin,webContentsId:9,current:()=>true,proxyRealm:realm});other.armNavigation(origin+'/entry');other.beforeRequest(request);other.beforeSendHeaders(request);assert.deepEqual(other.headersReceived({...request,statusCode:407,responseHeaders:{'Proxy-Authenticate':['Basic realm="unknown"']}}),{cancel:true});
});
test('R2 accepts Electron rawData bytes while refusing file or unsupported upload representations',()=>{
 const gate=createRequestGate({origin,webContentsId:9,current:()=>true});gate.armSubmit({url:origin+'/save',body:'customer=0007',contentType:'application/x-www-form-urlencoded'});assert.deepEqual(gate.beforeRequest(row({uploadData:[{type:'rawData',bytes:Buffer.from('customer=0007')}]})),{cancel:false});
 for(const type of ['file','blob','rawData-extra']){const other=createRequestGate({origin,webContentsId:9,current:()=>true});other.armSubmit({url:origin+'/save',body:'customer=0007',contentType:'application/x-www-form-urlencoded'});assert.deepEqual(other.beforeRequest(row({uploadData:[{type,bytes:Buffer.from('customer=0007')}]})),{cancel:true});}
});
