// W6 6E4: the document desk. The owner sets the outline, the client files and the figures table; code works out every
// amount; the owner approves the brief, takes the accepted AI draft, approves the document and exports it. Every action
// sends the digest the owner saw. The screen never computes money: figure lines are the engine's words.
import {useState} from 'react';
import {useT} from '../../../text';
import {useEngine,useResource} from '../../../engine/context';
import {EngineError} from '../../../engine/types';
import {Tile,TileHead} from '../../../parts/Tile';
import {Button} from '../../../parts/Button';
import {Field} from '../../../parts/Field';
import { DOCUMENT_TYPE_LABELS } from '../../../../../../platform/shared/venture/playbooks/document-desk/core.ts';
import { DOCUMENT_TYPES } from '../../../../../../platform/shared/venture/playbooks/document-desk/records.ts';
import type { DocumentBody } from '../../../../../../platform/runtime/venture/playbooks/document-desk/records.ts';
import s from './R5.module.css';
import { Select } from '../../../parts/Select';

type Item=DocumentBody&{id:string;stale:boolean;briefApproved:boolean;approved:boolean;figureWords:string[];missing:string[]};
type OutFile={name:string;contentBase64:string};
const OFFERS=['handbook-sop','project-report','estimate','thesis-edit','technical-writing'];
const P='document-desk';

export function DocumentDeskDesk(){
 const t=useT(),w=(k:string)=>t('pb-document.'+k),engine=useEngine();
 const [selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[exported,setExported]=useState<OutFile[]>([]);
 const plan=useResource('venture.blueprint.get',{}),orders=useResource('venture.order.list',{}),runs=useResource('venture.delivery.list',{});
 const detail=useResource('venture.desk.get',{playbook:P,kind:'document',id:selected},{skip:!selected,refreshOn:e=>e.type==='desk.changed'});
 const files=useResource('venture.files.list',{orderId:selected},{skip:!selected});
 const offers=new Set((plan.data?.blueprint.offers??[]).filter(o=>OFFERS.includes(o.playbookOffer??'')).map(o=>o.id));
 const mine=(orders.data??[]).filter(o=>offers.has(o.offerId)&&o.status!=='cancelled');
 const raw=detail.data?.item as Item|undefined,item=!detail.error&&raw?.orderId===selected?raw:undefined,missing=detail.error?.code==='DOCUMENT_NOT_FOUND';
 async function act(action:string,payload:Record<string,unknown>,withDigest=true){
  if(busy||!selected)return null;setBusy(true);setError('');
  try{const out=await engine.request('venture.desk.act',{playbook:P,kind:'document',id:selected,action,payload:payload as never,...(withDigest&&detail.data?{digest:detail.data.digest}:{})});detail.reload();return out;}
  catch(e){setError(e instanceof EngineError?(t('pb-document.error.'+e.code)!=='pb-document.error.'+e.code?t('pb-document.error.'+e.code):e.message):String(e));return null;}
  finally{setBusy(false);}
 }
 return <section className={s.stack} aria-label={w('title')}>
  <Tile as="section" label={w('title')}>
   <TileHead title={w('title')}/>
   <p className={s.line}>{w('intro')}</p>
   <label className={s.label}>{w('order')}<Select value={selected} onChange={e=>{setSelected(e.target.value);setExported([]);setError('');}}><option value="">{w('choose')}</option>{mine.map(o=><option key={o.id} value={o.id}>{o.request}</option>)}</Select></label>
   {error&&<p role="alert" className={s.error}>{error}</p>}
   {selected&&missing&&<CreateForm key={selected} files={(files.data??[]).map(f=>({id:f.id,name:f.name}))} busy={busy} create={(payload)=>act('create',payload,false)}/>}
  </Tile>
  {item&&<DocumentView key={item.id+item.sections.length} item={item} busy={busy} act={act} exported={exported} setExported={setExported} runs={(runs.data??[]).filter(r=>r.orderId===selected&&r.status==='accepted').map(r=>({id:r.id,title:r.deliverable?.title??r.id}))} files={(files.data??[]).map(f=>({id:f.id,name:f.name}))}/>}
 </section>;
}

function CreateForm({files,busy,create}:{files:{id:string;name:string}[];busy:boolean;create:(payload:Record<string,unknown>)=>Promise<unknown>}){
 const t=useT(),w=(k:string)=>t('pb-document.'+k),[type,setType]=useState<string>(DOCUMENT_TYPES[0]),[title,setTitle]=useState(''),[chosen,setChosen]=useState<string[]>([]);
 const locked=busy||!title.trim()||!chosen.length;
 return <form className={s.form} onSubmit={e=>{e.preventDefault();if(!locked)void create({docType:type,title,sourceFileIds:chosen});}}>
  <label className={s.label}>{w('type')}<Select value={type} onChange={e=>setType(e.target.value)}>{DOCUMENT_TYPES.map(id=><option key={id} value={id}>{DOCUMENT_TYPE_LABELS[id]}</option>)}</Select></label>
  <Field label={w('name')} value={title} onChange={e=>setTitle(e.target.value)}/>
  <fieldset className={s.form}><legend>{w('files')}</legend>{files.length?files.map(f=><label key={f.id} className={s.row}><input type="checkbox" checked={chosen.includes(f.id)} onChange={e=>setChosen(v=>e.target.checked?[...v,f.id]:v.filter(id=>id!==f.id))}/><span data-content>{f.name}</span></label>):<p className={s.line}>{w('noFiles')}</p>}</fieldset>
  <Button type="submit" variant="primary" locked={locked}>{w('create')}</Button>
 </form>;
}

type Act=(action:string,payload:Record<string,unknown>,withDigest?:boolean)=>Promise<unknown>;
function DocumentView({item,busy,act,exported,setExported,runs,files}:{item:Item;busy:boolean;act:Act;exported:OutFile[];setExported:(f:OutFile[])=>void;runs:{id:string;title:string}[];files:{id:string;name:string}[]}){
 const t=useT(),w=(k:string)=>t('pb-document.'+k);
 const [outline,setOutline]=useState(item.sections.map(row=>row.brief?`${row.heading}: ${row.brief}`:row.heading).join('\n'));
 const [currency,setCurrency]=useState(item.figures?.currency??'INR');
 const [lines,setLines]=useState('');
 const [run,setRun]=useState(runs[0]?.id??'');
 const parsedOutline=outline.split('\n').map(line=>line.trim()).filter(Boolean).map(line=>{const at=line.indexOf(':');return at>0?{heading:line.slice(0,at).trim(),brief:line.slice(at+1).trim()}:{heading:line,brief:''};});
 const parsedLines=lines.split('\n').map(line=>line.trim()).filter(Boolean).map(line=>{const [label='',quantity='',unit='']=line.split('|').map(part=>part.trim());return {label,quantity,unit};});
 return <>
  <Tile as="section" label={item.title}>
   <TileHead title={item.title}/>
   <p className={s.line}>{item.approved?w('approved'):item.briefApproved?w('briefApproved'):''}</p>
   {item.stale&&<div className={s.form}><p role="alert" className={s.error}>{w('stale')}</p><Button locked={busy} onClick={()=>void act('sources',{sourceFileIds:files.filter(f=>item.sourceFileIds.includes(f.id)).map(f=>f.id)})}>{w('rechoose')}</Button></div>}
   <Field multiline rows={6} label={w('outline')} hint={w('outlineHelp')} value={outline} onChange={e=>setOutline(e.target.value)}/>
   <Button locked={busy||!parsedOutline.length} onClick={()=>void act('outline',{sections:parsedOutline})}>{w('saveOutline')}</Button>
   <h4>{w('figures')}</h4>
   {item.figureWords.length>0&&<><ul className={s.list}>{item.figureWords.filter(line=>!line.startsWith('Receipt ')).map(line=><li key={line} data-content>{line}</li>)}</ul><p className={s.line}>{w('figuresByCode')}</p></>}
   <label className={s.label}>{w('currency')}<Select value={currency} onChange={e=>setCurrency(e.target.value)}>{['INR','USD','EUR','GBP'].map(c=><option key={c} value={c}>{c}</option>)}</Select></label>
   <Field multiline rows={4} label={w('figures')} hint={w('figuresHelp')} value={lines} onChange={e=>setLines(e.target.value)}/>
   <Button locked={busy} onClick={()=>void act('figures',{currency,lines:parsedLines})}>{w('saveFigures')}</Button>
   <Button variant="primary" locked={busy||item.briefApproved||item.stale} onClick={()=>void act('approve-brief',{})}>{w('approveBrief')}</Button>
  </Tile>
  <Tile as="section" label={w('sections')}>
   <TileHead title={w('sections')}/>
   {runs.length>0&&<div className={s.row}><label className={s.label}>{w('draft')}<Select value={run} onChange={e=>setRun(e.target.value)}>{runs.map(r=><option key={r.id} value={r.id}>{r.title}</option>)}</Select></label><Button locked={busy||!run||!item.briefApproved} onClick={()=>void act('take-draft',{runId:run})}>{w('takeDraft')}</Button></div>}
   {item.sections.map(row=><SectionEdit key={row.id+row.text} id={row.id} heading={row.heading} brief={row.brief} text={row.text} busy={busy} act={act}/>)}
   <Button variant="primary" locked={busy||item.approved||!item.briefApproved||item.missing.length>0} onClick={()=>void act('approve',{})}>{w('approve')}</Button>
   <Button locked={busy||!item.approved} onClick={()=>void act('export',{}).then(out=>{const files=(out as {result?:{files?:OutFile[]}}|null)?.result?.files;if(files)setExported(files);})}>{w('export')}</Button>
   {exported.length>0&&<><p className={s.line}>{w('sent')}</p><ul className={s.list}>{exported.map(f=><li key={f.name}><a href={'data:application/octet-stream;base64,'+f.contentBase64} download={f.name}><span data-content>{f.name}</span></a></li>)}</ul></>}
  </Tile>
 </>;
}

function SectionEdit({id,heading,brief,text,busy,act}:{id:string;heading:string;brief:string;text:string;busy:boolean;act:Act}){
 const t=useT(),w=(k:string)=>t('pb-document.'+k),[value,setValue]=useState(text);
 return <div className={s.form}><Field multiline rows={4} label={heading} hint={brief||undefined} value={value} onChange={e=>setValue(e.target.value)}/><Button locked={busy||value===text} onClick={()=>void act('section',{sectionId:id,text:value})}>{w('saveSection')}</Button></div>;
}
DocumentDeskDesk.ready=true;
