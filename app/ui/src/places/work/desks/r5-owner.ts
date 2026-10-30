import {useEffect,useRef,useState} from 'react';
import {useEngine,useEngineEvents,useResource} from '../../../engine/context';import {EngineError} from '../../../engine/types';import {useT} from '../../../text';
export type R5Act=(id:string,action:string,payload:Record<string,unknown>,digest?:string)=>Promise<{id:string;result:unknown}|null>;
/** Each desk owns its resources. Only actual Forget or owner selection invalidates a pending result. */
export function useR5Desk(playbook:'monitored-data'|'it-triage',kind:'source'|'channel'){
 const engine=useEngine(),t=useT(),[selected,setSelected]=useState(()=>playbook==='monitored-data'?new URLSearchParams(globalThis.location?.hash.split('?')[1]??'').get('watchSource')??'':''),[creating,setCreating]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[generation,setGeneration]=useState(0),life=useRef({alive:true,epoch:0});
 useEffect(()=>{life.current.alive=true;return()=>{life.current.alive=false;life.current.epoch++;};},[engine]);
 const choose=(id:string)=>{life.current.epoch++;setSelected(id);setGeneration(v=>v+1);setBusy(false);setError('');};
 useEngineEvents(event=>{if(event.type==='privacy.forgotten'){choose('');setCreating(false);}});
 const orders=useResource('venture.desk.list',{playbook,kind:'orders'}),list=useResource('venture.desk.list',{playbook,kind}),detail=useResource('venture.desk.get',{playbook,kind,id:selected},{skip:!selected});
 const act:R5Act=async(id,action,payload,digest)=>{if(busy)return null;const epoch=life.current.epoch,current=()=>life.current.alive&&life.current.epoch===epoch;setBusy(true);setError('');try{const result=await engine.request('venture.desk.act',{playbook,kind,id,action,payload:payload as never,...(digest?{digest}:{})});if(!current())return null;list.reload();detail.reload();return result;}catch(e){if(current()){const key='pb-r5.error.'+(e instanceof EngineError?e.code:'REQUEST_FAILED'),line=t(key);setError(line===key?t('pb-r5.error.REQUEST_FAILED'):line);}return null;}finally{if(current())setBusy(false);}};
 return{selected,creating,setCreating,busy,error,generation,choose,orders,list,detail,act};
}
export function downloadR5(file:{filename:string;mime?:string;text?:string;contentBase64?:string}){const data=file.contentBase64?Uint8Array.from(atob(file.contentBase64),c=>c.charCodeAt(0)):file.text??'',url=URL.createObjectURL(new Blob([data],{type:file.mime??'text/plain;charset=utf-8'}));try{const link=document.createElement('a');link.href=url;link.download=file.filename;link.click();}finally{URL.revokeObjectURL(url);}}
