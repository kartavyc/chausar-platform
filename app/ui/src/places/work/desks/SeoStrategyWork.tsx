/** SEO7 record-bound experiments. The screen never supplies or computes success figures. */
import {useState} from 'react';
import {useEngine,useResource} from '../../../engine/context';
import {useT} from '../../../text';
import {Tile} from '../../../parts/Tile';
import {Button} from '../../../parts/Button';
import type {SeoStrategy,SeoPublication} from '../../../../../../platform/runtime/venture/playbooks/seo-visibility/records';
import type {SeoWorkItem} from '../../../../../../platform/runtime/venture/playbooks/seo-visibility/work-core';
import s from './SeoVisibilityDesk.module.css';
const base={playbook:'seo-visibility' as const,kind:'strategy'};
export function SeoStrategyWork(){
 const t=useT(),engine=useEngine(),[workId,setWork]=useState(''),[panelId,setPanel]=useState(''),[publicationId,setPublication]=useState(''),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const work=useResource('venture.desk.list',{...base,kind:'work'}),panels=useResource('venture.desk.list',{...base,kind:'panel'}),publications=useResource('venture.desk.list',{...base,kind:'publishing'}),list=useResource('venture.desk.list',base),detail=useResource('venture.desk.get',{...base,id:selected},{skip:!selected});
 const works=(work.data?.rows??[]) as SeoWorkItem[],panelRows=(panels.data?.rows??[]) as {id:string;state:string;questionCount:number}[],pubs=(publications.data?.rows??[]) as (SeoPublication&{id:string})[],rows=(list.data?.rows??[]) as (SeoStrategy&{id:string})[],item=detail.data?.item as SeoStrategy|undefined;
 async function act(action:'create'|'measure'){setBusy(true);setNotice('');setError('');try{const response=await engine.request('venture.desk.act',{...base,id:action==='create'?'new':selected,action,...(action==='create'?{}:{digest:detail.data?.digest}),payload:action==='create'?{workId,panelId}:{publicationId}});setSelected(response.id);const result=response.result as SeoStrategy;setNotice(t('pb-seo-strategy.state.'+result.state));list.reload();detail.reload();}catch{setError(t('pb-seo-strategy.failed'));}finally{setBusy(false);}}
 return <Tile as="section"><details><summary>{t('pb-seo-strategy.title')}</summary><p>{t('pb-seo-strategy.boundary')}</p><form className={s.form} onSubmit={e=>{e.preventDefault();void act('create');}}>
  <label className={s.label}>{t('pb-seo-strategy.work')}<select value={workId} onChange={e=>setWork(e.target.value)}><option value="">{t('pb-seo-publish.choose')}</option>{works.filter(w=>w.operation==='content'&&w.state==='approved'&&!w.stale&&w.result.pass).map((w,i)=><option key={w.id} value={w.id}>{t('pb-seo-publish.draftNumber',{number:i+1})} · {w.checkedAt.slice(0,10)}</option>)}</select></label>
  <label className={s.label}>{t('pb-seo-strategy.panel')}<select value={panelId} onChange={e=>setPanel(e.target.value)}><option value="">{t('pb-seo-publish.choose')}</option>{panelRows.filter(p=>p.state==='approved').map((p,i)=><option key={p.id} value={p.id}>{t('pb-seo-strategy.panelNumber',{number:i+1,questions:p.questionCount})}</option>)}</select></label>
  <Button type="submit" locked={!workId||!panelId} disabled={busy}>{t('pb-seo-strategy.start')}</Button>
 </form><ul className={s.list}>{rows.map((row,i)=><li key={row.id}><Button onClick={()=>setSelected(row.id)}>{t('pb-seo-strategy.experiment',{number:i+1})}</Button><span>{t('pb-seo-strategy.state.'+row.state)}</span></li>)}</ul>
 {item&&<><p>{t('pb-seo-strategy.state.'+item.state)}</p><label className={s.label}>{t('pb-seo-strategy.publication')}<select value={publicationId} onChange={e=>setPublication(e.target.value)}><option value="">{t('pb-seo-publish.choose')}</option>{pubs.filter(p=>p.acceptance?.pass&&p.orderId===item.orderId).map((p,i)=><option key={p.id} value={p.id}>{t('pb-seo-publish.draftNumber',{number:i+1})} · {p.acceptance!.checkedOn}</option>)}</select></label><Button variant="primary" locked={!publicationId||item.state==='stopped'||!detail.data?.digest} disabled={busy} onClick={()=>void act('measure')}>{t('pb-seo-strategy.measure')}</Button>{item.measurementReceipt&&<details><summary>{t('pb-seo-work.evidence')}</summary><p data-content>{item.measurementReceipt}</p></details>}</>}
 {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}</details></Tile>;
}
