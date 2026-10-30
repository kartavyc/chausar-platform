/**
 * The Recruiting desk desk on Work (Ink v2 wave 5, packages 5H). Package 5-0 left it a stub that says it is not built
 * yet; the package replaces this file with the desk (it may import parts of its own from other files).
 */

import {useState} from 'react';
import { useT } from '../../../text';
import {useEngine,useResource} from '../../../engine/context';
import {EngineError} from '../../../engine/types';
import {Button} from '../../../parts/Button';
import {Tile,TileHead} from '../../../parts/Tile';
import {Field} from '../../../parts/Field';
import type {RecruitRoleView,RecruitAct} from './recruiting-types';
import {RecruitCandidates} from './RecruitCandidates';
import {RecruitRoleTools} from './RecruitRoleTools';
import s from './RecruitingDesk.module.css';

export function RecruitingDeskDesk() {
  const t = useT(),engine=useEngine();const [creating,setCreating]=useState(false),[orderId,setOrder]=useState(''),[selected,setSelected]=useState(()=>new URLSearchParams(globalThis.location?.hash.split('?')[1]??'').get('recruitRole')??''),[answer,setAnswer]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const roles=useResource('venture.desk.list',{playbook:'recruiting-desk',kind:'role'},{refreshOn:e=>e.type==='desk.changed'}),orders=useResource('venture.order.list',{}),detail=useResource('venture.desk.get',{playbook:'recruiting-desk',kind:'role',id:selected},{skip:!selected,refreshOn:e=>e.type==='desk.changed'});
  const loadedRole=detail.data?.item as RecruitRoleView|undefined,role=loadedRole?.id===selected?loadedRole:undefined,rows=(roles.data?.rows??[]) as RecruitRoleView[];
  const act:RecruitAct=async(kind,id,action,payload,digest)=>{setBusy(true);setError('');try{const result=await engine.request('venture.desk.act',{playbook:'recruiting-desk',kind,id,action,payload,...(digest?{digest}:{})});roles.reload();detail.reload();return result as {id:string;result:any};}catch(e){const key='pb-recruit.error.'+(e instanceof EngineError?e.code:'REQUEST_FAILED'),words=t(key);setError(words===key?t('pb-recruit.error.REQUEST_FAILED'):words);return null;}finally{setBusy(false);}};
  return <section className={s.stack} aria-label={t('pb-recruit.title')}><Tile as="section" label={t('pb-recruit.title')}><TileHead title={t('pb-recruit.title')} end={<Button onClick={()=>setCreating(!creating)}>{t('pb-recruit.new')}</Button>}/><p className={s.line}>{t('pb-recruit.intro')}</p>
  {error&&<p role="alert" className={s.error}>{error}</p>}
  {creating&&<form aria-label={t('pb-recruit.new')} className={s.form} onSubmit={e=>{e.preventDefault();if(orderId&&!busy)void act('role','new','create',{serviceOrderId:orderId}).then(r=>{if(r){setSelected(r.id);setCreating(false);}});}}><label className={s.label}>{t('pb-recruit.order')}<select value={orderId} onChange={e=>setOrder(e.target.value)} required><option value="">{t('pb-recruit.choose')}</option>{orders.data?.filter(o=>o.status!=='cancelled').map(o=><option value={o.id} key={o.id}>{o.request}</option>)}</select></label><Button variant="primary" type="submit" aria-disabled={busy||!orderId}>{t('pb-recruit.start')}</Button></form>}
  <ul className={s.list}>{rows.map(r=><li key={r.id}><Button onClick={()=>{setSelected(r.id);setAnswer('');}}>{r.brief?.title??t('pb-recruit.unfinished')}</Button><span>{t('pb-recruit.roleStatus.'+r.status)}</span></li>)}</ul></Tile>
  {role&&<><Tile as="section" label={t('pb-recruit.role')}><TileHead title={role.brief?.title??t('pb-recruit.role')}/>
   {role.question?<form className={s.form} aria-label={t('pb-recruit.questions')} onSubmit={e=>{e.preventDefault();if(busy)return;const q=role.question!;const value=['hardRules','mustHaves','exclusions','targetCompanies','searchWords'].includes(q.id)?answer.split('\n').map(x=>x.trim()).filter(Boolean):answer;void act('role',role.id,'answer',{questionId:q.id,value}).then(r=>{if(r)setAnswer('');});}}><Field multiline label={t('pb-recruit.question.'+role.question.id)} hint={t('pb-recruit.suggestion.'+role.question.id)} value={answer} onChange={e=>setAnswer(e.target.value)}/><Button variant="primary" type="submit" aria-disabled={busy}>{t('pb-recruit.answer')}</Button></form>:<>
    <details><summary>{t('pb-recruit.briefs')}</summary><p className={s.line}>{t('pb-recruit.publicBrief')}</p><pre data-content className={s.quote}>{role.brief?.publicDescription}</pre><p className={s.line}>{t('pb-recruit.privateBrief')}</p><pre data-content className={s.quote}>{role.brief?.privateSourcingNote}</pre></details>
    <ul className={s.list}>{role.brief?.criteria.map(c=><li key={c.id}><span data-content>{c.text} · {c.verify}</span>{role.approvedRules.includes(c.id)?<span>{t('pb-recruit.approved')}</span>:<Button aria-disabled={busy} onClick={()=>{if(!busy)void act('role',role.id,'approve-rule',{criterionId:c.id},detail.data?.digest);}}>{t('pb-recruit.approveRule')}</Button>}</li>)}</ul><p className={s.line}>{t('pb-recruit.privacyHold')}</p></>}
  </Tile>{role.brief&&<RecruitRoleTools key={'tools-'+role.id+'-'+role.version} role={role} digest={detail.data?.digest} act={act} busy={busy}/>} {role.status==='open'&&<RecruitCandidates key={'candidates-'+role.id+'-'+role.version+'-'+role.approvedDigest} role={role} act={act} busy={busy}/>}</>}
  </section>;
}
RecruitingDeskDesk.ready=true;
