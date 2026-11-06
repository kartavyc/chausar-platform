import { useState } from 'react';
import { useEngine, useResource } from '../../engine/context';
import type { ClientAiConsentView, EngineClient } from '../../engine/types';
import { Button } from '../../parts/Button';
import { navigate } from '../../shell/navigation';
import { useT } from '../../text';
import s from './Clients.module.css';
import { Fold } from '../../parts/Fold';
import { LoadingPlace } from '../../parts/Skeleton';

/** The one way a client's AI permission is recorded: the owner's press on the exact words this view showed. */
export const allowClientAi=(engine:EngineClient,clientId:string,view:ClientAiConsentView)=>engine.request('venture.client.aiConsent.agree',{clientId,disclosureDigest:view.disclosureDigest});

/**
 * The client's AI permission. C4 task 19 (161.x1): right after Allow, when an order of this client is waiting (open, no
 * draft started), one button starts it. Allow never starts anything by itself; the owner presses again. The refusal's own
 * "Allow and start" on Work is B4 task 4's.
 */
export function AiConsent({clientId,clientName}:{clientId:string;clientName:string}) {
  const engine=useEngine(),t=useT();const resource=useResource('venture.client.aiConsent.get',{clientId});
  const orders=useResource('venture.order.list',{}),runs=useResource('venture.delivery.list',{});
  const [busy,setBusy]=useState(false),[problem,setProblem]=useState<string|null>(null),[justAllowed,setJustAllowed]=useState(false);
  const view=resource.data?.clientId===clientId?resource.data:undefined;
  const started=new Set((runs.data??[]).filter(run=>!run.practice).map(run=>run.orderId));
  const waiting=justAllowed&&view?.status==='agreed'&&runs.data?(orders.data??[]).filter(order=>order.clientId===clientId&&order.status==='open'&&!order.internal&&!started.has(order.id)).at(-1):undefined;
  async function start(orderId:string) {
    if(busy)return;
    setBusy(true);setProblem(null);
    try {
      await engine.request('venture.delivery.run',{orderId});
      setJustAllowed(false);
      navigate({place:'work',query:{order:orderId}});
    } catch(error) {setProblem(error instanceof Error?error.message:String(error));}
    finally {setBusy(false);}
  }
  async function act() {
    if(busy || resource.loading || resource.error || !view)return;
    setBusy(true);setProblem(null);
    try {
      if(view.status==='agreed'){await engine.request('venture.client.aiConsent.withdraw',{clientId});setJustAllowed(false);}
      else {await allowClientAi(engine,clientId,view);setJustAllowed(true);}
      resource.reload();
    } catch(error) {setProblem(error instanceof Error?error.message:String(error));resource.reload();}
    finally {setBusy(false);}
  }
  return <Fold summary={<span>{t('clients.ai.title')}{view && <span className={s.state}> · {t(`clients.ai.${view.status}`)}</span>}</span>} className={s.aiConsent}>
    <div className={s.inlineForm}>
      {(problem || resource.error) && <p className={s.failed} role="alert">{problem??resource.error?.message}</p>}
      {!view && !resource.error && <LoadingPlace shape="sheet" />}
      {view && !resource.error && <><p data-content className={s.quiet}>{view.disclosure}</p><div className={s.formActions}><Button locked={busy||resource.loading} onClick={()=>void act()}>{t(view.status==='agreed'?'clients.ai.withdraw':'clients.ai.allow')}</Button>{waiting&&<Button variant="primary" locked={busy} onClick={()=>void start(waiting.id)}>{t('clients.ai.startOrder',{name:clientName})}</Button>}</div></>}
      {resource.error && <Button locked={resource.loading} onClick={resource.reload}>{t('clients.ai.retry')}</Button>}
    </div>
  </Fold>;
}
