/** SEO10 exact reviewed drafts and existing KV changes. No action here publishes WordPress live. */
import {useState} from 'react';
import {useEngine,useResource} from '../../../engine/context';
import {useT} from '../../../text';
import {Tile,TileHead} from '../../../parts/Tile';
import {Field} from '../../../parts/Field';
import {Button} from '../../../parts/Button';
import type {SeoPublication} from '../../../../../../platform/runtime/venture/playbooks/seo-visibility/records';
import s from './SeoVisibilityDesk.module.css';
const base={playbook:'seo-visibility' as const,kind:'publishing'};
export function SeoPublishingWork(){
 const t=useT(),engine=useEngine(),[runId,setRun]=useState(''),[publicationId,setPublication]=useState(''),[url,setUrl]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[failed,setFailed]=useState(false);
 const deliveries=useResource('venture.delivery.list',{}),list=useResource('venture.desk.list',base),preview=useResource('venture.desk.get',{...base,id:runId},{skip:!runId}),publication=useResource('venture.desk.get',{...base,id:publicationId},{skip:!publicationId});
 const item=preview.data?.item as {title:string;text?:string;content:string;site:string}|undefined,rows=(list.data?.rows??[]) as (SeoPublication&{id:string})[];
 async function act(action:'send'|'verify'){setBusy(true);setNotice('');setFailed(false);try{const result=await engine.request('venture.desk.act',{...base,id:action==='send'?runId:publicationId,action,digest:action==='send'?preview.data?.digest:publication.data?.digest,payload:action==='send'?{}:{url}});const answer=result.result as {outcome?:string;pass?:boolean};setNotice(t('pb-seo-publish.'+(action==='verify'?(answer.pass?'verified':'verifyFailed'):(answer.outcome==='applied'?'saved':answer.outcome==='not-sent'?'notSent':'unknown'))));if(action==='send')setRun('');list.reload();publication.reload();}catch{setFailed(true);setNotice(t('pb-seo-publish.failed'));}finally{setBusy(false);}}
 return <section className={s.stack}><Tile as="section"><details><summary>{t('pb-seo-publish.title')}</summary><p>{t('pb-seo-publish.boundary')}</p>
  <label className={s.label}>{t('pb-seo-publish.article')}<select value={runId} onChange={e=>{setRun(e.target.value);setNotice('');}}><option value="">{t('pb-seo-publish.choose')}</option>{deliveries.data?.filter(r=>!r.practice&&['accepted','edited'].includes(r.status)).map(r=><option key={r.id} value={r.id}>{r.deliverable?.title??r.id}</option>)}</select></label>
  {preview.error&&<p role="alert">{t('pb-seo-publish.needsApproval')}</p>}
  {item&&<><p data-content>{item.site}</p><h3 data-content>{item.title}</h3><p data-content>{item.text??item.content}</p><Button variant="primary" disabled={busy} locked={!preview.data?.digest} onClick={()=>void act('send')}>{t('pb-seo-publish.send')}</Button></>}
  {!!rows.length&&<><label className={s.label}>{t('pb-seo-publish.savedDraft')}<select value={publicationId} onChange={e=>setPublication(e.target.value)}><option value="">{t('pb-seo-publish.choose')}</option>{rows.filter(r=>r.outcome==='applied').map((r,i)=><option key={r.id} value={r.id}>{t('pb-seo-publish.draftNumber',{number:i+1})} · {r.at.slice(0,10)}</option>)}</select></label>{publicationId&&<><Field label={t('pb-seo-publish.liveUrl')} type="url" value={url} onChange={e=>setUrl(e.target.value)}/><Button locked={!url||!publication.data?.digest} disabled={busy} onClick={()=>void act('verify')}>{t('pb-seo-publish.verify')}</Button></>}</>}
  {notice&&<p role={failed?'alert':'status'}>{notice}</p>}
 </details></Tile><SeoEdgeWork/></section>;
}
function SeoEdgeWork(){
 const t=useT(),engine=useEngine(),[runId,setRun]=useState(''),[path,setPath]=useState(''),[after,setAfter]=useState(''),[summary,setSummary]=useState(''),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const edge={playbook:'seo-visibility' as const,kind:'edge'},deliveries=useResource('venture.delivery.list',{}),list=useResource('venture.desk.list',edge),view=useResource('venture.desk.get',{...edge,id:selected},{skip:!selected});
 const rows=(list.data?.rows??[]) as {id:string;summary:string}[],item=view.data?.item as {before:string;after:string;state:string;summary:string}|undefined;
 async function act(action:'stage'|'apply'|'rollback'){setBusy(true);setNotice('');try{const result=await engine.request('venture.desk.act',{...edge,id:action==='stage'?'new':selected,action,...(action==='stage'?{}:{digest:view.data?.digest}),payload:action==='stage'?{runId,path,after,summary}:{}});setSelected(result.id);list.reload();view.reload();const row=result.result as {state:string};setNotice(t('pb-seo-publish.edge.'+(action==='stage'?'staged':row.state==='needs-inspection'?'inspect':action==='rollback'?'undone':'applied')));}catch{setNotice(t('pb-seo-publish.failed'));}finally{setBusy(false);}}
 return <Tile as="section"><details><summary>{t('pb-seo-publish.edge.title')}</summary><p>{t('pb-seo-publish.edge.boundary')}</p><form className={s.form} onSubmit={e=>{e.preventDefault();void act('stage');}}>
  <label className={s.label}>{t('pb-seo-publish.article')}<select value={runId} onChange={e=>setRun(e.target.value)}><option value="">{t('pb-seo-publish.choose')}</option>{deliveries.data?.filter(r=>!r.practice&&['accepted','edited'].includes(r.status)).map(r=><option key={r.id} value={r.id}>{r.deliverable?.title??r.id}</option>)}</select></label>
  <Field label={t('pb-seo-publish.edge.path')} value={path} onChange={e=>setPath(e.target.value)} required/><Field multiline label={t('pb-seo-publish.edge.after')} value={after} onChange={e=>setAfter(e.target.value)} required/><Field label={t('pb-seo-publish.edge.reason')} value={summary} onChange={e=>setSummary(e.target.value)} required/>
  <Button type="submit" locked={!runId||!path||!after||!summary} disabled={busy}>{t('pb-seo-publish.edge.stage')}</Button>
 </form><ul className={s.list}>{rows.map(r=><li key={r.id}><Button onClick={()=>setSelected(r.id)}><span data-content>{r.summary}</span></Button></li>)}</ul>
 {item&&<><TileHead title={t('pb-seo-publish.edge.review')}/><p>{t('pb-seo-publish.edge.before')}</p><p data-content>{item.before}</p><p>{t('pb-seo-publish.edge.after')}</p><p data-content>{item.after}</p>{item.state==='staged'&&<Button variant="primary" disabled={busy} onClick={()=>void act('apply')}>{t('pb-seo-publish.edge.apply')}</Button>}{item.state==='applied'&&<Button disabled={busy} onClick={()=>void act('rollback')}>{t('pb-seo-publish.edge.undo')}</Button>}</>}
 {notice&&<p role="status">{notice}</p>}</details></Tile>;
}
