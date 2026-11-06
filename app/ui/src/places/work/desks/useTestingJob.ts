import {useEffect,useRef,useState} from 'react';
import {useEngine,useEngineEvents,useResource} from '../../../engine/context';import {useT} from '../../../text';
import type {Json} from '../../../../../../platform/runtime/portable';import type {DemoJob,TestJob} from './app-testing-types';
export function useTestingJob<T extends DemoJob|TestJob>(kind:'test'|'demo',orderId:string,clientId:string,parentLocked:boolean){
 const engine=useEngine(),t=useT(),[busy,setBusy]=useState(false),[error,setError]=useState(''),life=useRef(0),busyNow=useRef(false),last=useRef<{job:T;digest:string}|null>(null),started=useRef(false);
 const list=useResource('venture.desk.list',{playbook:'app-testing',kind},{refreshOn:e=>e.type==='desk.changed'||e.type==='privacy.forgotten'}),detail=useResource('venture.desk.get',{playbook:'app-testing',kind,id:orderId},{refreshOn:e=>e.type==='desk.changed'||e.type==='privacy.forgotten'});
 const exists=(list.data?.rows as {id:string}[]|undefined)?.some(r=>r.id===orderId)??false,raw=detail.data?.item as T|undefined;
 const loading=parentLocked||list.loading||(exists&&detail.loading),failed=!!list.error||!!(exists&&detail.error),valid=!loading&&!failed&&exists&&raw?.orderId===orderId&&raw.clientId===clientId;
 if(valid)last.current={job:raw,digest:detail.data!.digest};if(!loading&&!failed&&!exists)last.current=null;if(!loading&&!failed)started.current=true;
 const locked=loading||failed||busy,live=useRef({locked,valid,expected:last.current?.digest});live.current={locked,valid,expected:last.current?.digest};
 useEffect(()=>()=>{life.current++;},[]);useEngineEvents(e=>{if(e.type==='privacy.forgotten'){life.current++;last.current=null;setBusy(false);busyNow.current=false;setError('');}});
 async function act(action:string,payload:Json,openingRevision?:string|null){if(live.current.locked||busyNow.current)return null;const mine=life.current,expected=openingRevision===undefined?live.current.expected:openingRevision;busyNow.current=true;setBusy(true);setError('');try{const out=await engine.request('venture.desk.act',{playbook:'app-testing',kind,id:orderId,action,payload,...(expected?{digest:expected}:{})});if(life.current!==mine)return null;list.reload();detail.reload();return out.result as Record<string,unknown>;}catch(e){if(life.current===mine){const code=e instanceof Error&&'code'in e?String(e.code):'FAILED';setError(t('pb-app-testing.error',{code}));}return null;}finally{if(life.current===mine){busyNow.current=false;setBusy(false);}}}
 return{engine,act,job:last.current?.job,hash:last.current?.digest,locked,loading,failed,error,started:started.current,reload(){list.reload();detail.reload();}};
}
