import test from 'node:test';
import assert from 'node:assert/strict';
import { MCPService, MCP_PROTOCOL_VERSION } from '../runtime/mcp.ts';
import { VentureTestStore } from './venture-test-store.ts';
import { ChausarError, type Context } from '../runtime/contracts.ts';
const owner: Context={memberId:'owner',role:'owner',epoch:1,channel:'desktop'};
const empty={type:'object',additionalProperties:false,properties:{}};
async function ready(mcp:MCPService){await mcp.handle(owner,{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:MCP_PROTOCOL_VERSION,capabilities:{},clientInfo:{name:'scripted-agent',version:'1'}}});await mcp.handle(owner,{jsonrpc:'2.0',method:'notifications/initialized'});}
const call=(mcp:MCPService,name:string,args:Record<string,unknown>={})=>mcp.handle(owner,{jsonrpc:'2.0',id:2,method:'tools/call',params:{name,arguments:args}});

test('job MCP exposes only registered tools and never gives callbacks owner approval authority',async()=>{
 let seen:Context|undefined;
 const mcp=new MCPService(new VentureTestStore(),{calculations:[],tools:[{name:'order_read',description:'Read this job order.',inputSchema:empty,readOnly:true,call:async(_args:Record<string,unknown>,ctx:Context)=>{seen=ctx;return {orderId:'order_sample'};}}]});
 await ready(mcp);const answer=await call(mcp,'order_read');
 assert.equal(answer?.error,undefined);assert.deepEqual((answer?.result as any)?.structuredContent,{untrusted:true,source:'order_read',data:{orderId:'order_sample'}});
 assert.equal(seen?.channel,'mcp');assert.equal(seen?.sourceTainted,true);
 assert.equal((await call(mcp,'queue_decide',{action:'approve'}))?.error?.data?.code,'UNKNOWN_TOOL');
});

test('job authorization is rechecked after an asynchronous tool and suppresses revoked data',async()=>{
 let active=true;let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
 const mcp=new MCPService(new VentureTestStore(),{calculations:[],authorize:()=>{if(!active)throw new ChausarError('CLIENT_AI_CONSENT_REQUIRED','Client permission was withdrawn.');},tools:[{name:'order_read',description:'Read this job order.',inputSchema:empty,readOnly:true,call:async()=>{await wait;return {privateText:'must-not-cross-boundary'};}}]});
 await ready(mcp);const pending=call(mcp,'order_read');await Promise.resolve();active=false;release();const result=await pending;
 assert.equal(result?.error?.data?.code,'CLIENT_AI_CONSENT_REQUIRED');assert.equal(JSON.stringify(result).includes('must-not-cross-boundary'),false);
});
