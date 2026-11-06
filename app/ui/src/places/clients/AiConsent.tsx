import { useState } from 'react';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { useT } from '../../text';
import s from './Clients.module.css';

export function AiConsent({clientId}:{clientId:string}) {
  const engine=useEngine(),t=useT();const resource=useResource('venture.client.aiConsent.get',{clientId});
  const [busy,setBusy]=useState(false),[problem,setProblem]=useState<string|null>(null);
  const view=resource.data?.clientId===clientId?resource.data:undefined;
  async function act() {
    if(busy || resource.loading || resource.error || !view)return;
    setBusy(true);setProblem(null);
    try {
      if(view.status==='agreed')await engine.request('venture.client.aiConsent.withdraw',{clientId});
      else await engine.request('venture.client.aiConsent.agree',{clientId,disclosureDigest:view.disclosureDigest});
      resource.reload();
    } catch(error) {setProblem(error instanceof Error?error.message:String(error));resource.reload();}
    finally {setBusy(false);}
  }
  return <details className={s.aiConsent}>
    <summary>{t('clients.ai.title')}{view && <span className={s.state}> · {t(`clients.ai.${view.status}`)}</span>}</summary>
    <div className={s.inlineForm}>
      {(problem || resource.error) && <p className={s.failed} role="alert">{problem??resource.error?.message}</p>}
      {!view && !resource.error && <p className={s.quiet}>{t('sheet.loading')}</p>}
      {view && !resource.error && <><p data-content className={s.quiet}>{view.disclosure}</p><div className={s.formActions}><Button locked={busy||resource.loading} onClick={()=>void act()}>{t(view.status==='agreed'?'clients.ai.withdraw':'clients.ai.allow')}</Button></div></>}
      {resource.error && <Button locked={resource.loading} onClick={resource.reload}>{t('clients.ai.retry')}</Button>}
    </div>
  </details>;
}

/** C5 task 7: one Allow AI for new clients, with its own words one fold away. Off by default; clients already here keep their own. */
export function AiDefault() {
  const engine=useEngine(),t=useT();const resource=useResource('venture.client.aiDefault.get',{});
  const [busy,setBusy]=useState(false),[problem,setProblem]=useState<string|null>(null);
  const view=resource.data;
  async function set(on:boolean) {
    if(busy||!view)return;
    setBusy(true);setProblem(null);
    try {await engine.request('venture.client.aiDefault.set',{on,digest:view.digest});resource.reload();}
    catch(error) {setProblem(error instanceof Error?error.message:String(error));resource.reload();}
    finally {setBusy(false);}
  }
  if(!view)return null;
  return <details className={s.aiConsent}>
    <summary>{t('clients.aiDefault.title')}<span className={s.state}> · {t(view.on?'clients.aiDefault.on':'clients.aiDefault.off')}</span></summary>
    <div className={s.inlineForm}>
      {problem && <p className={s.failed} role="alert">{problem}</p>}
      <p className={s.quiet}>{view.line}</p>
      <p data-content className={s.quiet}>{view.disclosure}</p>
      <div className={s.formActions}><Button locked={busy} onClick={()=>void set(!view.on)}>{t(view.on?'clients.aiDefault.turnOff':'clients.aiDefault.turnOn')}</Button></div>
    </div>
  </details>;
}
