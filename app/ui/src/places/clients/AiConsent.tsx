import { useState } from 'react';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { useT } from '../../text';
import s from './Clients.module.css';
import { LoadingPlace } from '../../parts/Skeleton';

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
      {!view && !resource.error && <LoadingPlace shape="sheet" />}
      {view && !resource.error && <><p data-content className={s.quiet}>{view.disclosure}</p><div className={s.formActions}><Button locked={busy||resource.loading} onClick={()=>void act()}>{t(view.status==='agreed'?'clients.ai.withdraw':'clients.ai.allow')}</Button></div></>}
      {resource.error && <Button locked={resource.loading} onClick={resource.reload}>{t('clients.ai.retry')}</Button>}
    </div>
  </details>;
}
