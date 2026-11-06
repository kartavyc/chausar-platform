// W6 6E5: the sign-off desk. Name the licensed professional who signs each kind of paper, see what the regulator
// switches off and which rules were checked on the regulator's own page, then send each regulated draft to sign. The
// professional signs by typing their registration number; only signed papers can be accepted or shared.
import {useState} from 'react';
import {useT} from '../../../text';
import {useEngine,useResource} from '../../../engine/context';
import {EngineError} from '../../../engine/types';
import {Tile,TileHead} from '../../../parts/Tile';
import {Button} from '../../../parts/Button';
import {Field} from '../../../parts/Field';
import s from './R5.module.css';
import { Fold } from '../../../parts/Fold';

const P='signoff-desk';
type Professional={profession:string;label:string;registryLabel:string;hint:string;professional:{name:string;registrationNumber:string}|null;switchedOff:{tool:string;line:string}[];rules:{id:string;title:string;line:string;url:string;checked:boolean}[]};
type PaperRow={runId:string;title:string;profession:string;stage:string;line:string|null};
type Paper=PaperRow&{registryLabel:string;professional:{name:string}|null;request:{id:string;sent:{name:string}|null;decision:{decision:string}|null}|null};

function useAct(){
 const t=useT(),engine=useEngine(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function act(kind:string,id:string,action:string,payload:Record<string,unknown>,digest?:string){
  if(busy)return null;setBusy(true);setError('');
  try{return await engine.request('venture.desk.act',{playbook:P,kind,id,action,payload:payload as never,...(digest?{digest}:{})});}
  catch(e){const key='pb-signoff.error.'+(e instanceof EngineError?e.code:'');setError(e instanceof EngineError?(t(key)!==key?t(key):e.message):String(e));return null;}
  finally{setBusy(false);}
 }
 return {busy,error,act};
}

export function SignoffDeskDesk(){
 const t=useT(),w=(k:string)=>t('pb-signoff.'+k),{busy,error,act}=useAct(),[selected,setSelected]=useState('');
 const people=useResource('venture.desk.list',{playbook:P,kind:'professional'},{refreshOn:e=>e.type==='desk.changed'});
 const papers=useResource('venture.desk.list',{playbook:P,kind:'paper'},{refreshOn:e=>e.type==='desk.changed'||e.type.startsWith('run.')});
 const rows=(people.data?.rows??[]) as Professional[],paperRows=(papers.data?.rows??[]) as PaperRow[];
 return <section className={s.stack} aria-label={w('title')}>
  <Tile as="section" label={w('title')}>
   <TileHead title={w('title')}/>
   <p className={s.line}>{w('intro')}</p>
   {error&&<p role="alert" className={s.error}>{error}</p>}
   <h4>{w('professionals')}</h4>
   <ul className={s.list}>{rows.map(row=><ProfessionalRow key={row.profession+(row.professional?.registrationNumber??'')} row={row} busy={busy} save={payload=>act('professional',row.profession,'name',payload)}/>)}</ul>
  </Tile>
  <Tile as="section" label={w('papers')}>
   <TileHead title={w('papers')}/>
   {paperRows.length?<ul className={s.list}>{paperRows.map(row=><li key={row.runId}><Button onClick={()=>setSelected(row.runId)}><span data-content>{row.title}</span></Button><p className={s.line}>{w('stage.'+row.stage)}</p></li>)}</ul>:<p className={s.line}>{w('noPapers')}</p>}
   {selected&&<PaperView key={selected} runId={selected} busy={busy} act={act}/>}
  </Tile>
 </section>;
}

function ProfessionalRow({row,busy,save}:{row:Professional;busy:boolean;save:(payload:Record<string,unknown>)=>Promise<unknown>}){
 const t=useT(),w=(k:string)=>t('pb-signoff.'+k),[name,setName]=useState(row.professional?.name??''),[number,setNumber]=useState(row.professional?.registrationNumber??'');
 return <li className={s.form}>
  <strong>{row.label}</strong>
  <p className={s.line}>{row.professional?<span data-content>{row.professional.name}, {row.professional.registrationNumber}</span>:w('none')}</p>
  <Field label={w('name')} value={name} onChange={e=>setName(e.target.value)}/>
  <Field label={row.registryLabel} hint={row.hint} value={number} onChange={e=>setNumber(e.target.value)}/>
  <Button locked={busy||!name.trim()||!number.trim()} onClick={()=>void save({name,registrationNumber:number})}>{w('save')}</Button>
  {row.switchedOff.length>0&&<><p className={s.line}>{w('switchedOff')}</p><ul className={s.list}>{row.switchedOff.map(item=><li key={item.tool}>{item.line}</li>)}</ul></>}
  <Fold summary={w('rules')}><ul className={s.list}>{row.rules.map(rule=><li key={rule.id}><a href={rule.url} target="_blank" rel="noreferrer">{rule.title}</a>: {rule.line} <em>{rule.checked?w('checked'):w('unchecked')}</em></li>)}</ul></Fold>
 </li>;
}

function PaperView({runId,busy,act}:{runId:string;busy:boolean;act:(kind:string,id:string,action:string,payload:Record<string,unknown>,digest?:string)=>Promise<unknown>}){
 const t=useT(),w=(k:string)=>t('pb-signoff.'+k),[number,setNumber]=useState(''),[note,setNote]=useState('');
 const detail=useResource('venture.desk.get',{playbook:P,kind:'paper',id:runId},{refreshOn:e=>e.type==='desk.changed'});
 const paper=detail.data?.item as Paper|undefined,digest=detail.data?.digest;
 if(!paper)return null;
 const sendable=['not-asked','unsent','changed'].includes(paper.stage),waiting=paper.stage==='sent';
 return <div className={s.form}>
  <h4><span data-content>{paper.title}</span></h4>
  <p className={s.line}>{paper.line??w('signed')}</p>
  {sendable&&<Button variant="primary" locked={busy||!paper.professional} onClick={()=>void act('paper',runId,'send',{},digest).then(()=>detail.reload())}>{w('send')}</Button>}
  {waiting&&<>
   <Field label={paper.registryLabel} value={number} onChange={e=>setNumber(e.target.value)}/>
   <Button variant="primary" locked={busy||!number.trim()} onClick={()=>void act('paper',runId,'sign',{registrationNumber:number},digest).then(()=>detail.reload())}>{w('sign')}</Button>
   <Field label={w('note')} value={note} onChange={e=>setNote(e.target.value)}/>
   <Button locked={busy} onClick={()=>void act('paper',runId,'return',note.trim()?{note}:{},digest).then(()=>detail.reload())}>{w('return')}</Button>
  </>}
 </div>;
}
SignoffDeskDesk.ready=true;
