// Real hosted request handler over standard HTTP request/response objects, without opening a socket. Original Chausar test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { IncomingMessage,ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { createHostedServer } from '../runtime/hosted/server.ts';
import type { HostedApp } from '../runtime/hosted/app.ts';
const token='a'.repeat(32);
async function request(method:string,body?:string,origin='https://app.example.com'){
 const calls:unknown[]=[];const app={options:{},async supportRating(...args:unknown[]){calls.push(args);return {language:'en',answered:method==='POST'};},async close(){}} as unknown as HostedApp;
 const host=createHostedServer(app,{origin:'https://app.example.com',tls:{kind:'none'},trustProxy:false,maxBodyBytes:10000});
 const req=new IncomingMessage(new Socket());req.method=method;req.url=`/support-rating/${token}`;req.headers={host:'app.example.com',...(method==='POST'?{origin,'content-type':'application/x-www-form-urlencoded','sec-fetch-site':'same-origin'}:{})};
 const res=new ServerResponse(req);
 const result=await new Promise<{status:number;html:string;headers:Record<string,unknown>}>(resolve=>{res.end=((data?:unknown)=>{resolve({status:res.statusCode,html:typeof data==='string'?data:'',headers:res.getHeaders()});return res;}) as typeof res.end;host.server.emit('request',req,res);if(body)req.push(body);req.push(null);});
 host.server.close();return {...result,calls};
}
test('public rating route has a same-origin form, no scripts/pixels, and GET never records a score',async()=>{
 const result=await request('GET');assert.equal(result.status,200);assert.match(result.html,/How was your support/);assert.match(result.html,/<form method="post">/);assert.doesNotMatch(result.html,/<script|<img|<iframe|buyer@example/);assert.match(String(result.headers['content-security-policy']),/default-src 'none'/);assert.equal((result.calls[0] as unknown[]).length,2);
 const head=await request('HEAD');assert.equal(head.status,200);assert.equal(head.html,'');
});
test('public rating POST accepts one same-origin score and refuses foreign origin or repeated score keys',async()=>{
 const good=await request('POST','score=5');assert.equal(good.status,200);assert.deepEqual((good.calls[0] as unknown[])[2],5);
 const foreign=await request('POST','score=5','https://elsewhere.example');assert.equal(foreign.status,403);assert.equal(foreign.calls.length,0);
 const repeated=await request('POST','score=5&score=1');assert.equal(repeated.status,400);assert.equal(repeated.calls.length,0);
});
