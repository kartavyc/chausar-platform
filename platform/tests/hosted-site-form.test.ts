// Real hosted request handler over standard HTTP request/response objects, without opening a socket. Original Chausar test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { IncomingMessage,ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { createHostedServer } from '../runtime/hosted/server.ts';
import type { HostedApp } from '../runtime/hosted/app.ts';
const token='a'.repeat(32);
async function request(method:string,body?:string,origin='https://client.example'){
 const calls:unknown[]=[];const app={options:{},async siteForm(...args:unknown[]){calls.push(args);return method==='POST'?{accepted:true,language:'en'}:{active:true,notice:'Only your name and email for this request.',language:'en'};},async close(){}} as unknown as HostedApp;
 const host=createHostedServer(app,{origin:'https://app.example.com',tls:{kind:'none'},trustProxy:false,maxBodyBytes:10000});
 const req=new IncomingMessage(new Socket());req.method=method;req.url=`/site-form/${token}`;req.headers={host:'app.example.com',...(method==='POST'?{origin,'content-type':'application/x-www-form-urlencoded','sec-fetch-site':'same-origin'}:{})};
 const res=new ServerResponse(req);
 const result=await new Promise<{status:number;html:string;headers:Record<string,unknown>}>(resolve=>{res.end=((data?:unknown)=>{resolve({status:res.statusCode,html:typeof data==='string'?data:'',headers:res.getHeaders()});return res;}) as typeof res.end;host.server.emit('request',req,res);if(body)req.push(body);req.push(null);});
 host.server.close();return {...result,calls};
}
test('site form route forwards only exact consent fields and the browser origin',async()=>{const good=await request('POST','name=Dev&email=dev%40example.com&consent=true&source=https%3A%2F%2Fclient.example%2Fcontact');assert.equal(good.status,200);assert.deepEqual((good.calls[0] as unknown[])[2],{operation:'submit',name:'Dev',email:'dev@example.com',consent:true,source:'https://client.example/contact',origin:'https://client.example'});assert.doesNotMatch(good.html,/dev@example|<script|<img/);const repeated=await request('POST','name=Dev&name=Other&email=dev%40example.com&consent=true&source=https%3A%2F%2Fclient.example');assert.equal(repeated.status,400);assert.equal(repeated.calls.length,0);assert.match(repeated.html,/अनुरोध दर्ज नहीं हुआ/);});
test('site form page shows the approved purpose without client data or tracking',async()=>{const page=await request('GET');assert.equal(page.status,200);assert.match(page.html,/Only your name and email/);assert.doesNotMatch(page.html,/<script|<img|<iframe/);});
