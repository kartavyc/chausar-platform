/** Owner-only, session-scoped publishing credentials. Each write has a separate review. */
import {useState} from 'react';
import {useEngine} from '../../engine/context';
import {useT} from '../../text';
import {Tile} from '../../parts/Tile';
import {Field} from '../../parts/Field';
import {Button} from '../../parts/Button';
import s from '../work/desks/SeoVisibilityDesk.module.css';
export function SeoConnections({embedded=false}:{embedded?:boolean}){
 const t=useT(),engine=useEngine();const [url,setUrl]=useState(''),[username,setUser]=useState(''),[password,setPassword]=useState(''),[accountId,setAccount]=useState(''),[namespaceId,setNamespace]=useState(''),[token,setToken]=useState(''),[siteUrl,setSite]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[failed,setFailed]=useState(false);
 async function act(kind:'publishing'|'edge',action:'configure'|'disconnect'){
  setBusy(true);setFailed(false);setNotice('');try{await engine.request('venture.desk.act',{playbook:'seo-visibility',kind,id:'connection',action,payload:action==='disconnect'?{}:kind==='publishing'?{url,username,password}:{accountId,namespaceId,token,siteUrl}});setPassword('');setToken('');setNotice(t('pb-seo-connect.'+(action==='configure'?'connected':'removed')));}catch{setFailed(true);setNotice(t('pb-seo-connect.failed'));}finally{setBusy(false);}
 }
 const content=<><p>{t('pb-seo-connect.scope')}</p><div className={s.stack}>
  <form className={s.form} onSubmit={e=>{e.preventDefault();void act('publishing','configure');}} aria-label={t('pb-seo-connect.wordpress')}>
   <Field label={t('pb-seo-connect.url')} value={url} onChange={e=>setUrl(e.target.value)} type="url" required/>
   <Field label={t('pb-seo-connect.username')} value={username} onChange={e=>setUser(e.target.value)} autoComplete="username" required/>
   <Field label={t('pb-seo-connect.password')} value={password} onChange={e=>setPassword(e.target.value)} type="password" autoComplete="off" required/>
   <Button type="submit" disabled={busy}>{t('pb-seo-connect.wordpress')}</Button><Button variant="quiet" disabled={busy} onClick={()=>void act('publishing','disconnect')}>{t('pb-seo-connect.removeWordpress')}</Button>
  </form>
  <details><summary>{t('pb-seo-connect.edge')}</summary><p>{t('pb-seo-connect.edgeScope')}</p><form className={s.form} onSubmit={e=>{e.preventDefault();void act('edge','configure');}} aria-label={t('pb-seo-connect.edge')}>
   <Field label={t('pb-seo-connect.site')} value={siteUrl} onChange={e=>setSite(e.target.value)} type="url" required/>
   <Field label={t('pb-seo-connect.account')} value={accountId} onChange={e=>setAccount(e.target.value)} required/>
   <Field label={t('pb-seo-connect.namespace')} value={namespaceId} onChange={e=>setNamespace(e.target.value)} required/>
   <Field label={t('pb-seo-connect.token')} value={token} onChange={e=>setToken(e.target.value)} type="password" autoComplete="off" required/>
   <Button type="submit" disabled={busy}>{t('pb-seo-connect.connectEdge')}</Button><Button variant="quiet" disabled={busy} onClick={()=>void act('edge','disconnect')}>{t('pb-seo-connect.removeEdge')}</Button>
  </form></details>
 </div>{notice&&<p role={failed?'alert':'status'}>{notice}</p>}</>;
 return embedded?<section aria-label={t('pb-seo-connect.title')}>{content}</section>:<Tile as="section"><details><summary>{t('pb-seo-connect.title')}</summary>{content}</details></Tile>;
}
