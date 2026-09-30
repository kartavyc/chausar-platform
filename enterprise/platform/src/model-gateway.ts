import OpenAI from 'openai';
import { z } from 'zod';
import { Denied } from './shared.ts';
import { planJsonSchema, planningInstructions } from './planning.ts';

export const endpointSchema=z.object({
  api:z.enum(['chat_completions','responses']),baseUrl:z.string().url(),model:z.string().min(1).max(160),
  classification:z.enum(['private','external']),handlingReview:z.string().min(1).max(240),
  providerRetention:z.enum(['no_content_retention','reviewed_provider_policy']),
  timeoutMs:z.number().int().min(100).max(20000),maxOutputTokens:z.number().int().min(128).max(4096),
}).strict();
export type ModelEndpoint=z.infer<typeof endpointSchema>;
export type GatewayConfig={credentials:Readonly<Record<string,string>>;receiptKey:string;allowLoopbackHttp?:boolean};

/** No endpoint, credentials, provider parameters or tools are accepted from a user/model. */
export class ModelGateway {
  private config:GatewayConfig;
  constructor(config:GatewayConfig){
    if(Buffer.byteLength(config.receiptKey)<32)throw Error('Gateway receipt key must have at least 32 bytes');
    this.config={...config,credentials:Object.freeze({...config.credentials})};
  }
  get receiptKey(){return this.config.receiptKey;}
  async plan(endpointRef:string,rawEndpoint:unknown,context:unknown,
    beforeDispatch:(exactBody:string)=>Promise<void>):Promise<unknown> {
    const endpoint=endpointSchema.parse(rawEndpoint);const base=new URL(endpoint.baseUrl);
    if(base.username||base.password||base.search||base.hash||!base.pathname.endsWith('/'))throw new Denied('invalid_model_endpoint',503);
    if(base.protocol!=='https:'&&!(this.config.allowLoopbackHttp&&base.protocol==='http:'&&base.hostname==='127.0.0.1'))throw new Denied('invalid_model_endpoint',503);
    const credential=this.config.credentials[endpointRef];
    if(!credential)throw new Denied('model_credential_unavailable',503);
    const expectedUrl=new URL(endpoint.api==='responses'?'responses':'chat/completions',base).href;
    let sent=false;let gateFailure:unknown;
    // The SDK owns protocol support. This transport controls the final serialized bytes,
    // headers, destination, response bounds, redirects, and one attempt only.
    const guardedFetch:typeof fetch=async(url,init)=>{
      if(sent||String(url)!==expectedUrl||init?.method!=='POST'||typeof init.body!=='string')throw new Denied('model_transport_contract',502);
      if(Buffer.byteLength(init.body)>32768)throw new Denied('model_payload_too_large',413);
      try{await beforeDispatch(init.body);}catch(error){gateFailure=error;throw error;}
      sent=true;
      const response=await fetch(expectedUrl,{method:'POST',redirect:'error',
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${credential}`},
        body:init.body,signal:AbortSignal.timeout(endpoint.timeoutMs)});
      // Never let SDK exception/log handling ingest an arbitrary provider error body.
      if(!response.ok){await response.body?.cancel();throw new Denied('provider_outcome_unknown',502);}
      const reader=response.body?.getReader();if(!reader)throw new Denied('invalid_model_response',502);
      const chunks:Uint8Array[]=[];let size=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
        if(size>65536){await reader.cancel();throw new Denied('invalid_model_response',502);}chunks.push(value);}}
      finally{reader.releaseLock();}
      return new Response(Buffer.concat(chunks),{status:200,headers:{'Content-Type':'application/json'}});
    };
    const client=new OpenAI({apiKey:credential,baseURL:base.href,organization:null,project:null,
      maxRetries:0,timeout:endpoint.timeoutMs+5000,logLevel:'off',fetch:guardedFetch});
    try {
      const input=JSON.stringify(context);let text:string;
      if(endpoint.api==='responses'){
        const r=await client.responses.create({model:endpoint.model,store:false,stream:false,
          instructions:planningInstructions,input,max_output_tokens:endpoint.maxOutputTokens,
          text:{format:{type:'json_schema',name:'investigation_plan',strict:true,schema:planJsonSchema}}});
        if(r.status!=='completed')throw new Denied('invalid_model_response',422);
        const messages=r.output.filter(x=>x.type==='message');
        if(messages.length!==1||r.output.some(x=>!['message','reasoning'].includes(x.type)))throw new Denied('invalid_model_response',422);
        const content=messages[0]!.content;
        if(content.length!==1||content[0]!.type!=='output_text')throw new Denied('invalid_model_response',422);
        text=content[0]!.text;
      }else{
        const r=await client.chat.completions.create({model:endpoint.model,store:false,stream:false,
          messages:[{role:'system',content:planningInstructions},{role:'user',content:input}],
          max_completion_tokens:endpoint.maxOutputTokens,
          response_format:{type:'json_schema',json_schema:{name:'investigation_plan',strict:true,schema:planJsonSchema}}});
        if(r.choices.length!==1)throw new Denied('invalid_model_response',422);
        const c=r.choices[0]!;
        if(c.finish_reason!=='stop'||c.message.refusal||c.message.tool_calls?.length||c.message.function_call||typeof c.message.content!=='string')throw new Denied('invalid_model_response',422);
        text=c.message.content;
      }
      try{return JSON.parse(text);}catch{throw new Denied('invalid_model_response',422);}
    }catch(error){
      if(gateFailure)throw gateFailure;
      if(error instanceof Denied)throw error;
      throw new Denied(sent?'provider_outcome_unknown':'model_transport_unavailable',502);
    }
  }
}
