import { connect } from 'node:net';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import type { Readable, Writable } from 'node:stream';

/** Byte bounds apply before parsing, including a peer that never writes a newline. */
export async function* boundedLines(input:Readable,limit:number):AsyncGenerator<string> {
  let pending=Buffer.alloc(0);
  for await(const chunk of input) {
    pending=Buffer.concat([pending,Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)]);
    let end:number;
    while((end=pending.indexOf(10))>=0) {
      if(end>limit)throw new Error('Frame exceeds the local job limit.');
      const line=pending.subarray(0,end);pending=pending.subarray(end+1);
      yield line.toString('utf8').replace(/\r$/,'');
    }
    if(pending.length>limit)throw new Error('Frame exceeds the local job limit.');
  }
  if(pending.length)throw new Error('Incomplete local job frame.');
}
export async function writeLine(output:Writable,value:unknown):Promise<void> {
  if(!output.write(`${JSON.stringify(value)}\n`))await once(output,'drain');
}

/** This child has no vault or credentials. Its sole authority is a job-scoped local pipe. */
export async function runStdioBridge():Promise<void> {
  const address=process.env.CHAUSAR_AGENT_MCP_SOCKET,token=process.env.CHAUSAR_AGENT_MCP_TOKEN;
  delete process.env.CHAUSAR_AGENT_MCP_TOKEN;delete process.env.CHAUSAR_AGENT_MCP_SOCKET;
  if(!address || !token)throw new Error('The local job connection is unavailable.');
  const socket=connect(address);socket.once('close',()=>process.stdin.destroy());await once(socket,'connect');
  const responses=boundedLines(socket,262144)[Symbol.asyncIterator]();
  try {
    await writeLine(socket,{token});const hello=await responses.next();
    if(hello.done || JSON.parse(hello.value)?.ready!==true)throw new Error('The local job connection was refused.');
    const read=async()=>{
      for await(const line of boundedLines(process.stdin,65536)) {
        if(!socket.write(line+'\n'))await once(socket,'drain');
      }
      socket.end();
    };
    const receive=async()=>{
      for(;;){const line=await responses.next();if(line.done)return;if(!process.stdout.write(line.value+'\n'))await once(process.stdout,'drain');}
    };
    await Promise.all([read(),receive()]);
  } finally { socket.destroy();process.stdin.destroy(); }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  runStdioBridge().catch(()=>{process.stderr.write('The local job connection ended.\n');process.exitCode=1;});
}
