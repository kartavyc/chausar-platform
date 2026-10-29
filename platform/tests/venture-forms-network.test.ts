// Original R2 socket boundary regressions. Only temporary loopback fixture servers are contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {connect,createServer,type Socket} from 'node:net';
import {once} from 'node:events';
import {createFormsTunnel} from '../runtime/venture/build/form-fill-network.ts';

async function request(port:number,target:string,authorization:string|null){
 const socket=connect({host:'127.0.0.1',port});socket.setTimeout(3000,()=>socket.destroy(new Error('Fixture timed out')));await once(socket,'connect');
 const response=new Promise<string>((resolve,reject)=>{socket.once('data',data=>resolve(data.toString()));socket.once('error',reject);});
 socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${authorization?`Proxy-Authorization: ${authorization}\r\n`:''}\r\n`);
 return {socket,response:await response};
}

test('R2 private tunnel authenticates before DNS and refuses other origins and private answers',async()=>{
 let lookups=0,writes=0;
 const tunnel=await createFormsTunnel({origin:'https://records.example.com',current:()=>true,resolve:async()=>{lookups++;return [{address:'127.0.0.1',family:4}];},connect:()=>{writes++;throw new Error('Must not connect');}});
 try{
  const unauth=await request(tunnel.port,'records.example.com:443',null);assert.match(unauth.response,/407/);unauth.socket.destroy();assert.equal(lookups,0);
  const other=await request(tunnel.port,'other.example.com:443',tunnel.authorization);assert.match(other.response,/403/);other.socket.destroy();assert.equal(lookups,0);
  const privateIp=await request(tunnel.port,'records.example.com:443',tunnel.authorization);assert.match(privateIp.response,/403/);privateIp.socket.destroy();assert.equal(lookups,1);assert.equal(writes,0);
 }finally{await tunnel.close();}
});

test('R2 CONNECT dials the checked IP once and tears down its actual socket when the run closes',async()=>{
 const echo=createServer(socket=>socket.pipe(socket));echo.listen(0,'127.0.0.1');await once(echo,'listening');const port=(echo.address() as {port:number}).port;
 const calls:unknown[]=[];const controller=new AbortController();
 const tunnel=await createFormsTunnel({origin:'https://records.example.com',current:()=>true,signal:controller.signal,resolve:async()=>[{address:'8.8.8.8',family:4}],connect:target=>{calls.push(target);return connect({host:'127.0.0.1',port});}});
 let client:Socket|undefined;
 try{const reply=await request(tunnel.port,'records.example.com:443',tunnel.authorization);client=reply.socket;assert.match(reply.response,/200 Connection Established/);assert.deepEqual(calls,[{host:'8.8.8.8',port:443,family:4}]);const echoed=once(client,'data');client.write('synthetic TLS bytes');assert.equal((await echoed)[0].toString(),'synthetic TLS bytes');const closed=once(client,'close');controller.abort();await closed;assert.equal(calls.length,1);}finally{client?.destroy();await tunnel.close();await new Promise<void>(resolve=>echo.close(()=>resolve()));}
});

test('R2 revocation during DNS prevents any socket from opening',async()=>{
 let current=true,calls=0,release!:()=>void,entered!:()=>void;const enteredPromise=new Promise<void>(resolve=>entered=resolve);const blocked=new Promise<void>(resolve=>release=resolve);
 const tunnel=await createFormsTunnel({origin:'https://records.example.com',current:()=>current,resolve:async()=>{entered();await blocked;return [{address:'8.8.8.8',family:4}];},connect:()=>{calls++;throw new Error('Must not connect');}});
 try{const pending=request(tunnel.port,'records.example.com:443',tunnel.authorization);await enteredPromise;current=false;release();const reply=await pending;assert.match(reply.response,/403/);reply.socket.destroy();assert.equal(calls,0);}finally{release();await tunnel.close();}
});

test('R2 malformed authentication bytes are refused without crashing the listener',async()=>{
 const tunnel=await createFormsTunnel({origin:'https://records.example.com',current:()=>true,resolve:async()=>{throw new Error('No DNS for bad authorization');}});
 try{const reply=await request(tunnel.port,'records.example.com:443','Ã©'+tunnel.authorization.slice(2));assert.match(reply.response,/407/);reply.socket.destroy();}finally{await tunnel.close();}
});

test('R2 revocation on an already connected tunnel blocks later TLS bytes without waiting for new DNS',async()=>{
 let current=true,received!:()=>void;const arrived=new Promise<'received'>(resolve=>received=()=>resolve('received'));const server=createServer(socket=>socket.on('data',received));server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as {port:number}).port;
 const tunnel=await createFormsTunnel({origin:'https://records.example.com',current:()=>current,resolve:async()=>[{address:'8.8.8.8',family:4}],connect:()=>connect({host:'127.0.0.1',port})});let client:Socket|undefined;
 try{const connected=await request(tunnel.port,'records.example.com:443',tunnel.authorization);client=connected.socket;const ended=once(client,'close').then(()=> 'closed' as const);current=false;client.write('later synthetic TLS data');assert.equal(await Promise.race([arrived,ended]),'closed');}finally{client?.destroy();await tunnel.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
