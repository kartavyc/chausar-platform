// Original R2 local CONNECT enforcement. Uses Chausar's existing public-address guard; no remote proxy or TLS interception.
// Electron session.setProxy/webRequest docs read 29 October2026. The browser's separate exact-effect gate remains mandatory.
import {createServer} from 'node:http';
import {Transform} from 'node:stream';
import {connect as connectSocket,type Socket,type NetConnectOpts} from 'node:net';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {check} from '../../portable.ts';
import {checkUrl,resolvePublic,type NetResolver} from '../core/net-guard.ts';

export type FormsTunnel={port:number;proxyUrl:string;authorization:string;username:string;password:string;realm:string;close():Promise<void>};
export type FormsTunnelOptions={origin:string;current():boolean;signal?:AbortSignal;resolve?:NetResolver;connect?:(target:{host:string;port:443;family:4|6})=>Socket};

/** Host-only capability. Never serialize the credentials into a desk, journal, model preview or renderer response. */
export async function createFormsTunnel(options:FormsTunnelOptions):Promise<FormsTunnel>{
 const url=checkUrl(options.origin);
 check(url.protocol==='https:'&&url.origin===options.origin&&!url.port&&url.pathname==='/'&&!url.search&&!url.hash,'SITE_NOT_ALLOWED','Use one approved HTTPS client origin.');
 check(options.current()===true&&!options.signal?.aborted,'FORM_BROWSER_CLOSED','The data-entry browser approval is no longer current.');
 const username='chausar',password=randomBytes(32).toString('hex'),realm=randomBytes(16).toString('hex');
 const authorization='Basic '+Buffer.from(username+':'+password).toString('base64');
 const authBytes=Buffer.from(authorization);const sockets=new Set<Socket>();let closed=false;let closing:Promise<void>|null=null;
 const live=()=>{try{return !closed&&!options.signal?.aborted&&options.current()===true;}catch{return false;}};
 const server=createServer((_request,response)=>{response.writeHead(405,{'Connection':'close'});response.end();});
 server.headersTimeout=5000;server.requestTimeout=5000;server.maxHeadersCount=30;server.maxConnections=32;
 const track=(socket:Socket)=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));socket.on('error',()=>socket.destroy());};
 server.on('connection',track);server.on('clientError',(_error,socket)=>socket.destroy());
 const refuse=(socket:Socket,status=403)=>{if(!socket.destroyed)socket.end(`HTTP/1.1 ${status} ${status===407?'Proxy Authentication Required':'Forbidden'}\r\n${status===407?`Proxy-Authenticate: Basic realm="${realm}"\r\n`:''}Connection: close\r\nContent-Length: 0\r\n\r\n`);};
 server.on('connect',(request,rawSocket,head)=>{
  const socket=rawSocket as Socket;socket.pause();socket.setTimeout(15_000,()=>socket.destroy());
  const supplied=request.headers['proxy-authorization'];
  const suppliedBytes=typeof supplied==='string'?Buffer.from(supplied):null;
  if(!suppliedBytes||suppliedBytes.length!==authBytes.length||!timingSafeEqual(suppliedBytes,authBytes)){refuse(socket,407);return;}
  if(request.url!==url.hostname+':443'||head.length>65_536){refuse(socket);return;}
  void (async()=>{
   let deadline:ReturnType<typeof setTimeout>|undefined;
   try{
    if(!live())return refuse(socket);
    const checked=await Promise.race([resolvePublic(url.hostname,options.resolve),new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(new Error('Lookup expired')),10_000);deadline.unref();})]);
    if(!live()||socket.destroyed)return refuse(socket);
    const target={host:checked.address,port:443 as const,family:checked.family};
    const upstream=(options.connect??((value:NetConnectOpts)=>connectSocket(value)))(target);track(upstream);
    let outgoing:Transform|undefined,incoming:Transform|undefined;const stop=()=>{outgoing?.destroy();incoming?.destroy();socket.destroy();upstream.destroy();};upstream.once('error',stop);socket.once('close',stop);upstream.once('close',stop);
    upstream.setTimeout(30_000,stop);let bytes=0;
    const filtered=()=>{const stream=new Transform({transform(chunk:Buffer,_encoding,callback){bytes+=chunk.length;if(!live()||bytes>64*1024*1024){stop();callback();return;}callback(null,chunk);}});stream.on('error',stop);return stream;};outgoing=filtered();incoming=filtered();
    upstream.once('connect',()=>{
     if(!live()||socket.destroyed){stop();return;}
     socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
     outgoing!.pipe(upstream);incoming!.pipe(socket);if(head.length)outgoing!.write(head);socket.pipe(outgoing!);upstream.pipe(incoming!);socket.resume();
    });
   }catch{refuse(socket);}finally{if(deadline)clearTimeout(deadline);}
  })();
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
 const lifetime=setTimeout(()=>{void close();},20*60_000);lifetime.unref();
 async function close():Promise<void>{
  if(closing)return closing;closed=true;clearTimeout(lifetime);options.signal?.removeEventListener('abort',abort);
  for(const socket of sockets)socket.destroy();
  closing=new Promise<void>(resolve=>server.close(()=>resolve()));return closing;
 }
 const abort=()=>{void close();};options.signal?.addEventListener('abort',abort,{once:true});
 if(!live()){await close();check(false,'FORM_BROWSER_CLOSED','The data-entry browser approval is no longer current.');}
 const port=(server.address() as {port:number}).port;
 return {port,proxyUrl:`http://127.0.0.1:${port}`,authorization,username,password,realm,close};
}
