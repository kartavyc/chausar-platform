import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { createInterface } from 'node:readline';
import { MCPService, MCP_PROTOCOL_VERSION } from '../runtime/mcp.ts';
import { JobCapability } from '../runtime/venture/agent-runtime/scope.ts';
import { startJobBroker } from '../runtime/venture/agent-runtime/broker.ts';
import { VentureTestStore } from './venture-test-store.ts';
import type { Context } from '../runtime/contracts.ts';
const owner:Context={memberId:'owner',role:'owner',epoch:1,channel:'desktop'};
const scope={jobId:'job_sample',runId:'run_sample',ventureId:'venture_sample',orderId:'order_sample',clientId:'client_sample',agentId:'agent_sample',memberId:'owner',epoch:1,consentId:'consent_sample',consentRevision:1,generation:1};
async function setup(){const cap=new JobCapability(scope,owner,()=>{});const service=new MCPService(new VentureTestStore(),{calculations:[],authorize:()=>cap.assert(),tools:[{name:'read_order',description:'Synthetic scoped order.',inputSchema:{type:'object',additionalProperties:false,properties:{}},readOnly:true,call:()=>({id:scope.orderId})}]});return startJobBroker({service,capability:cap});}
const init={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:MCP_PROTOCOL_VERSION,capabilities:{},clientInfo:{name:'scripted-agent',version:'1'}}};
test('real stdio child reaches the worker-owned server using only environment capability, then stops on broker close',{timeout:15000},async t=>{
 const broker=await setup();t.after(()=>broker.close());const {connection}=broker;
 assert.equal(connection.args.some(arg=>arg.includes(connection.env.CHAUSAR_AGENT_MCP_TOKEN)),false);
 const child=spawn(connection.command,connection.args,{env:{...process.env,...connection.env},stdio:['pipe','pipe','pipe'],windowsHide:true});t.after(()=>child.kill());
 const lines=createInterface({input:child.stdout});const iterator=lines[Symbol.asyncIterator]();let errors='';child.stderr.on('data',chunk=>{errors+=String(chunk);});
 child.stdin.write(JSON.stringify(init)+'\n');const first=await iterator.next();assert.equal(JSON.parse(first.value!).result.protocolVersion,MCP_PROTOCOL_VERSION,errors);
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'read_order',arguments:{}}})+'\n');
 const reply=JSON.parse((await iterator.next()).value!);assert.equal(reply.result.structuredContent.data.id,scope.orderId);
 const ended=new Promise(resolve=>child.once('exit',resolve));await broker.close();await ended;assert.ok(!errors.includes(connection.env.CHAUSAR_AGENT_MCP_TOKEN));
});
test('wrong token and oversized frames close without accessing the job',{timeout:10000},async t=>{
 const broker=await setup();t.after(()=>broker.close());
 for(const message of [JSON.stringify({token:'incorrect'})+'\n','x'.repeat(65537)]) {
  const socket=connect(broker.connection.env.CHAUSAR_AGENT_MCP_SOCKET);let output='';socket.on('data',chunk=>{output+=String(chunk);});socket.on('error',()=>{});
  const closed=new Promise(resolve=>socket.once('close',resolve));socket.write(message);await closed;assert.equal(output,'');
 }
});
test('a finite stdio request stream drains replies before the bridge exits',{timeout:10000},async t=>{
 const broker=await setup();t.after(()=>broker.close());const c=broker.connection;
 const child=spawn(c.command,c.args,{env:{...process.env,...c.env},stdio:['pipe','pipe','pipe'],windowsHide:true});t.after(()=>child.kill());
 let output='';child.stdout.on('data',chunk=>{output+=String(chunk);});const ended=new Promise(resolve=>child.once('close',resolve));
 child.stdin.end(JSON.stringify(init)+'\n');await ended;
 assert.equal(JSON.parse(output.trim()).result.protocolVersion,MCP_PROTOCOL_VERSION);
});
