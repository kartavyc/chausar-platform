import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';

/** Instrumented synthetic provider, never a language model or semantic-quality test. */
export async function startModelFixture(){
  const received:{path:string;body:string;authorization:string|undefined}[]=[];
  let behavior:((body:any,res:ServerResponse)=>Promise<unknown>)|undefined;
  const server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    received.push({path:req.url!,body,authorization:req.headers.authorization});
    try{
      const payload=JSON.parse(body);
      const context=JSON.parse(payload.input??payload.messages[1].content);
      const plan=behavior?await behavior(context,res):{outcome:'execute',metricIds:['gross_inr'],regions:context.authorizedRegions,reason:'none'};
      if(res.writableEnded||res.destroyed||plan===undefined)return;
      const content=JSON.stringify(plan);res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify(req.url?.endsWith('/responses')?{
        id:'synthetic-response',object:'response',status:'completed',output:[{id:'synthetic-message',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:content,annotations:[]}]}]
      }:{id:'synthetic-chat',object:'chat.completion',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content}}]}));
    }catch{res.statusCode=500;res.end('{}');}
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const address=server.address();if(!address||typeof address==='string')throw Error('No fixture address');
  return {url:`http://127.0.0.1:${address.port}/v1/`,received,
    setBehavior:(fn:typeof behavior)=>{behavior=fn;},
    stop:async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}};
}
export type ModelFixture=Awaited<ReturnType<typeof startModelFixture>>;
