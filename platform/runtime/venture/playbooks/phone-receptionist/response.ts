// Original bounded provider invocation. A late adapter cannot release a response after timeout or workspace close.
import {check,ChausarError} from '../../../portable.ts';import type {VoiceCallsPort,VoiceCallResponse} from '../../build/voice-calls.ts';
export async function boundedVoiceResponse(respond:VoiceCallsPort['respond'],input:VoiceCallResponse,guard:()=>void,closing?:AbortSignal){
 const abort=new AbortController();let active=true;const ended=()=>abort.abort(),timer=setTimeout(ended,30_000);closing?.addEventListener('abort',ended,{once:true});if(closing?.aborted)ended();let rejectAbort:()=>void=()=>{};
 const stopped=new Promise<never>((_resolve,reject)=>{rejectAbort=()=>reject(new ChausarError('CALL_RESPONSE_STOPPED','The call response stopped before confirmation.'));abort.signal.addEventListener('abort',rejectAbort,{once:true});if(abort.signal.aborted)rejectAbort();});
 try{await Promise.race([stopped,Promise.resolve().then(()=>respond(input,()=>{check(active&&!abort.signal.aborted,'CALL_RESPONSE_STOPPED','This call response is no longer active.');guard();},abort.signal))]);}
 finally{active=false;clearTimeout(timer);closing?.removeEventListener('abort',ended);abort.signal.removeEventListener('abort',rejectAbort);abort.abort();}
}
