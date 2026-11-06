// Owner source and exact submission review. The actual client browser stays in its own desktop window.
import {useEffect,useRef,useState} from 'react';
import {useEngine,useEngineEvents,useResource} from '../../../engine/context';
import {EngineError} from '../../../engine/types';import {useT} from '../../../text';
import {Tile} from '../../../parts/Tile';import {Button} from '../../../parts/Button';import {Field} from '../../../parts/Field';
import {FormsRecord} from './FormsRecord';import {FormsBrowserStatus} from './FormsBrowserStatus';import s from './FormsDesk.module.css';
export const formsDesk={playbook:'data-entry-desk' as const,kind:'entries'};
export function DataEntryDeskDesk(){
 const t=useT(),w=(key:string)=>t('pb-forms.'+key),[order,setOrder]=useState(''),[selected,setSelected]=useState(''),[revision,setRevision]=useState(0);
 const orders=useResource('venture.order.list',{}),plan=useResource('venture.blueprint.get',{}),list=useResource('venture.desk.list',formsDesk),epoch=useRef(0);
 const permitted=new Set((plan.data?.blueprint.offers??[]).filter(o=>['data-entry-monthly','backlog-project'].includes(o.playbookOffer??'')).map(o=>o.id));
 const eligible=(orders.data??[]).filter(o=>permitted.has(o.offerId)&&(o.status==='open'||o.status==='invoiced'));
 useEngineEvents(event=>{if(event.type==='privacy.forgotten'){epoch.current++;setSelected('');setOrder('');setRevision(n=>n+1);}});
 const choose=(value:string)=>{epoch.current++;setOrder(value);setSelected('');setRevision(n=>n+1);};
 const currentOrder=!orders.loading&&!orders.error&&!plan.loading&&!plan.error&&!list.loading&&!list.error?eligible.find(value=>value.id===order):undefined;
 const rows=(list.data?.rows??[]) as {id:string;orderId:string;sourceRecordId?:string;state:string;stale?:boolean}[];
 return <div className={s.root}><h3>{w('heading')}</h3><p>{w('boundary')}</p><FormsBrowserStatus/><p>{w('manual')}</p>
  <label className={s.label}>{w('order')}<select className={s.select} value={order} onChange={e=>choose(e.target.value)}><option value="">{w('choose')}</option>{eligible.map(row=><option key={row.id} value={row.id}>{row.request}</option>)}</select></label>
  {(orders.error||plan.error||list.error)&&<p role="alert">{w('error.REQUEST_FAILED')}</p>}
  {currentOrder&&<FormsSource key={order+'.'+revision} orderId={order} onPrepared={id=>{setSelected(id);list.reload();}}/>}
  {currentOrder&&<ul className={s.list}>{rows.filter(row=>row.orderId===order).map(row=><li key={row.id}><Button onClick={()=>setSelected(row.id)}>{w('reviewRecord')} <span data-content="">{row.sourceRecordId??row.id}</span></Button></li>)}</ul>}
  {selected&&currentOrder&&<FormsRecord key={selected+'.'+revision+'.'+currentOrder.clientId} id={selected}/>}
 </div>;
}
function FormsSource({orderId,onPrepared}:{orderId:string;onPrepared:(id:string)=>void}){
 const t=useT(),w=(key:string)=>t('pb-forms.'+key),engine=useEngine(),files=useResource('venture.files.list',{orderId}),[file,setFile]=useState(''),[column,setColumn]=useState(''),[row,setRow]=useState('1'),[busy,setBusy]=useState(false),[error,setError]=useState(''),epoch=useRef(0);
 useEffect(()=>()=>{epoch.current++;},[]);useEngineEvents(event=>{if(event.type==='privacy.forgotten')epoch.current++;});const locked=busy||files.loading||!!files.error||!files.data?.some(value=>value.id===file)||!column||!/^([1-9][0-9]{0,2})$/.test(row)||Number(row)>200;
 async function prepare(){if(locked)return;const generation=epoch.current;setBusy(true);setError('');try{const reply=await engine.request('venture.desk.act',{...formsDesk,id:'new',action:'prepare',payload:{orderId,fileId:file,identityColumn:column,rowIndex:Number(row)-1}});if(generation===epoch.current)onPrepared(reply.id);}catch(cause){if(generation!==epoch.current)return;const code=cause instanceof EngineError?cause.code:'REQUEST_FAILED';setError(w('error.'+code).startsWith('pb-forms.')?w('error.REQUEST_FAILED'):w('error.'+code));}finally{if(generation===epoch.current)setBusy(false);}}
 return <Tile card><form className={s.form} aria-label={w('prepare')} onSubmit={event=>{event.preventDefault();void prepare();}}><label className={s.label}>{w('file')}<select className={s.select} value={file} disabled={busy} onChange={e=>setFile(e.target.value)}><option value="">{w('choose')}</option>{(files.data??[]).filter(value=>value.format==='csv'&&/\.csv$/i.test(value.name)).map(value=><option key={value.id} value={value.id}>{value.name}</option>)}</select></label><Field label={w('identity')} value={column} disabled={busy} onChange={e=>setColumn(e.target.value)}/><Field label={w('row')} hint={w('rowHelp')} inputMode="numeric" value={row} disabled={busy} onChange={e=>setRow(e.target.value)}/><Button type="submit" variant="primary" locked={locked}>{w('prepare')}</Button>{error&&<p role="alert" className={s.error}>{error}</p>}</form></Tile>;
}

DataEntryDeskDesk.ready=true;
