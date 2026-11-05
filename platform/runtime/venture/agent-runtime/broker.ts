import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import { chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MCPService } from '../../mcp.ts';
import type { JobCapability } from './scope.ts';
import type { AgentMcpConnection } from './driver-types.ts';
import { boundedLines, writeLine } from './stdio-bridge.ts';
import { runtimeEntry } from '../../engine-paths.ts';

export type JobBroker = {connection:AgentMcpConnection;close:()=>Promise<void>};
export async function startJobBroker(options:{service:MCPService;capability:JobCapability;executable?:string}):Promise<JobBroker> {
  const {service,capability}=options;capability.assert();
  const id=randomUUID(),token=randomBytes(32).toString('base64url');
  const path=process.platform==='win32'?`\\\\.\\pipe\\chausar-agent-${id}`:join(tmpdir(),`chausar-agent-${id}.sock`);
  const sockets=new Set<Socket>();let closed=false;
  const server=createServer({allowHalfOpen:true},socket=>{
    sockets.add(socket);socket.once('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    const sessionId=randomUUID();const context=capability.context;
    const timeout=setTimeout(()=>socket.destroy(),5000);timeout.unref();
    void (async()=>{
      let authenticated=false;
      try {
        for await(const line of boundedLines(socket,65536)) {
          capability.assert();
          if(!authenticated) {
            const auth=JSON.parse(line);const presented=typeof auth?.token==='string'?Buffer.from(auth.token):Buffer.alloc(0);const expected=Buffer.from(token);
            if(Object.keys(auth).length!==1 || presented.length!==expected.length || !timingSafeEqual(presented,expected)) break;
            authenticated=true;clearTimeout(timeout);await writeLine(socket,{ready:true});continue;
          }
          let request;try{request=JSON.parse(line);}catch{await writeLine(socket,{jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON.'}});continue;}
          const response=await service.handle(context,request,sessionId);
          capability.assert();if(response)await writeLine(socket,response);
        }
      } catch { /* A closed or revoked capability must not return private diagnostics. */ }
      finally { clearTimeout(timeout);service.close(context,sessionId);socket.destroy(); }
    })();
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(path,()=>{server.off('error',reject);resolve();});});
  if(process.platform!=='win32')await chmod(path,0o600);
  const connection:AgentMcpConnection={name:'chausar',command:options.executable??process.execPath,args:[runtimeEntry('venture/agent-runtime/stdio-bridge')],env:{ELECTRON_RUN_AS_NODE:'1',CHAUSAR_AGENT_MCP_SOCKET:path,CHAUSAR_AGENT_MCP_TOKEN:token}};
  return {connection,close:async()=>{
    if(closed)return;closed=true;capability.close();for(const socket of sockets)socket.destroy();
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    if(process.platform!=='win32')await rm(path,{force:true});
  }};
}
