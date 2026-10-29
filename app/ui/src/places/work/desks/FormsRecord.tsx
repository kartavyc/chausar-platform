// Exact source review and explicit browser steps. Resource failures never leave an old approval usable.
import {useState} from 'react';
import {useEngine,useEngineEvents,useResource} from '../../../engine/context';
import {EngineError} from '../../../engine/types';import {useT} from '../../../text';
import {Tile} from '../../../parts/Tile';import {Button} from '../../../parts/Button';
import type {EntryRecordBody} from '../../../../../../platform/runtime/venture/playbooks/data-entry-desk/records';
import type {FormCapture,SavedCapture} from '../../../../../../platform/runtime/venture/playbooks/data-entry-desk/browser-types';
import {FormsSite} from './FormsSite';import {FormsCapture,FormsReadback} from './FormsCapture';
import s from './FormsDesk.module.css';
const base={playbook:'data-entry-desk' as const,kind:'entries'};
export type FormsRow=EntryRecordBody&{id:string;stale:boolean;source:{columns:string[];values:Record<string,string>;totalRows:number}|null;capture:FormCapture|null;readback:SavedCapture|null;filmstrip?:{phase:'approved-form';pageHash:string;screenshot:{mime:string;base64:string}}[]};
export type FormsAct=(action:string,payload:Record<string,unknown>)=>Promise<void>;
export function FormsRecord({id}:{id:string}){
 const t=useT(),w=(key:string)=>t('pb-forms.'+key),engine=useEngine(),detail=useResource('venture.desk.get',{...base,id}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[forgotten,setForgotten]=useState(false);
 useEngineEvents(e=>{if(e.type==='privacy.forgotten'){setForgotten(true);setError('');}});
 const row=detail.data?.item as FormsRow|undefined,current=!forgotten&&!detail.loading&&!detail.error&&row?.id===id,locked=!current||busy||!!row?.stale;
 async function act(action:string,payload:Record<string,unknown>){if(!current||busy||row?.stale&&action!=='close'&&action!=='recover')return;setBusy(true);setError('');try{await engine.request('venture.desk.act',{...base,id,action,payload,digest:detail.data!.digest});detail.reload();}catch(cause){const code=cause instanceof EngineError?cause.code:'REQUEST_FAILED',label=w('error.'+code);setError(label.startsWith('pb-forms.')?w('error.REQUEST_FAILED'):label);detail.reload();}finally{setBusy(false);}}
 if(!current||!row)return <p role={detail.error?'alert':undefined}>{forgotten?w('cleared'):detail.error?w('error.REQUEST_FAILED'):w('loading')}</p>;
 return <section className={s.root} aria-label={w('entry')}><h4>{w('entry')}</h4>{error&&<p role="alert" className={s.error}>{error}</p>}{row.stale?<p role="alert">{w('stale')}</p>:<>
  <Tile card><h4>{w('source')}</h4><dl className={s.source}>{row.source?.columns.map(column=><div key={column}><dt data-content="">{column}</dt><dd data-content="">{row.source!.values[column]}</dd></div>)}</dl><p>{w('state.'+row.state)}</p></Tile>
  {['source','open','captured','filled','review','not-sent'].includes(row.state)&&<FormsSite row={row} locked={locked} act={act}/>}
  {['open','captured','filled','review'].includes(row.state)&&<Tile card><p>{w('captureHelp')}</p><Button variant="primary" locked={locked} onClick={()=>void act('capture',{})}>{w('capture')}</Button></Tile>}
  {row.capture&&row.state==='captured'&&<FormsCapture key={row.capture.pageHash} row={row} locked={locked} act={act}/>}
  {row.state==='review'&&row.submitReview&&<Tile card><h4>{row.submitIntent==='sign-in'?w('loginReview'):w('submitReview')}</h4><p data-content="">{row.submitReview.url}</p><p>{w('postHelp')}</p><dl className={s.source}>{row.submitReview.review.map(field=><div key={field.name}><dt data-content="">{field.name}</dt><dd data-content="">{field.value??w('hidden')}</dd></div>)}</dl><Button variant="primary" locked={locked||Date.parse(row.submitReview.expiresAt)<=Date.now()} onClick={()=>void act('submit',{})}>{w('submit')}</Button></Tile>}
  {row.state==='sign-in-response'&&<FormsSite row={row} locked={locked} act={act} continuation/>}
  {row.state==='response'&&<Tile card><p>{w('responseHelp')}</p><Button variant="primary" locked={locked} onClick={()=>void act('read-back',{})}>{w('readback')}</Button></Tile>}
  {row.state==='response'&&row.readback&&<FormsReadback key={row.readback.digest} row={row} locked={locked} act={act}/>}
  {row.filmstrip?.length?<Tile card><h4>{w('approvedScreenshot')}</h4>{row.filmstrip.map(value=><img key={value.pageHash} className={s.image} alt={w('approvedScreenshot')} src={'data:'+value.screenshot.mime+';base64,'+value.screenshot.base64}/>)}</Tile>:<p>{w('screenshotUnavailable')}</p>}
  {row.comparison&&<Tile card><h4>{w('comparison')}</h4><p>{w('comparison.'+row.comparison.status)}</p><p data-content="">{row.comparison.recordId??w('unverified')}</p>{row.comparison.differences.map(value=><div key={value.targetId}><p data-content="">{value.targetId}</p><p>{w('expected')}: <span data-content="">{value.expected}</span></p><p>{w('actual')}: <span data-content="">{value.actual??w('missing')}</span></p></div>)}</Tile>}
 </>}
 <Tile card><div className={s.actions}><Button locked={busy} onClick={()=>void act('close',{})}>{w('close')}</Button>{row.state==='submitting'&&<Button locked={busy} onClick={()=>void act('recover',{})}>{w('recover')}</Button>}</div></Tile>
 </section>;
}
