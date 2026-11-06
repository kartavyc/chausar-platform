import { useState } from 'react';
import { useEngine, useResource } from '../../engine/context';
import type { ClientAiConsentView, EngineClient } from '../../engine/types';
import { Button } from '../../parts/Button';
import { Icon } from '../../parts/Icon';
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
  const [expanded,setExpanded]=useState<boolean|null>(null);
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
      setExpanded(null);
      resource.reload();
    } catch(error) {setProblem(error instanceof Error?error.message:String(error));resource.reload();}
    finally {setBusy(false);}
  }
  return <div className={s.aiConsent}>
    <Fold open={expanded ?? view?.status !== 'agreed'} onToggle={event => setExpanded(event.currentTarget.open)} summary={<span>{t('clients.ai.title')}{view && <span> · {view.status === 'agreed' && <Icon name="check" size={16} />}<span>{t(`clients.ai.${view.status}`)}</span></span>}</span>}>
      <div className={s.inlineForm}>
        {!view && !resource.error && <LoadingPlace shape="sheet" />}
        {view && !resource.error && <><p data-content className={s.quiet}>{view.disclosure}</p>{view.status !== 'agreed' && <div className={s.formActions}><Button locked={busy||resource.loading} onClick={()=>void act()}>{t('clients.ai.allow')}</Button></div>}</>}
        {resource.error && <Button locked={resource.loading} onClick={resource.reload}>{t('clients.ai.retry')}</Button>}
      </div>
    </Fold>
    {(problem || resource.error) && <p className={s.failed} role="alert">{problem??resource.error?.message}</p>}
    {view?.status === 'agreed' && <div className={s.formActions}><Button size="sm" variant="quiet" locked={busy||resource.loading} onClick={()=>void act()}>{t('clients.ai.withdraw')}</Button>{waiting&&<Button variant="primary" locked={busy} onClick={()=>void start(waiting.id)}>{t('clients.ai.startOrder',{name:clientName})}</Button>}</div>}
  </div>;
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
  return <Fold summary={<span>{t('clients.aiDefault.title')}<span className={s.state}> Â· {t(view.on?'clients.aiDefault.on':'clients.aiDefault.off')}</span></span>} className={s.aiConsent}>
    <div className={s.inlineForm}>
      {problem && <p className={s.failed} role="alert">{problem}</p>}
      <p className={s.quiet}>{view.line}</p>
      <p data-content className={s.quiet}>{view.disclosure}</p>
      <div className={s.formActions}><Button locked={busy} onClick={()=>void set(!view.on)}>{t(view.on?'clients.aiDefault.turnOff':'clients.aiDefault.turnOn')}</Button></div>
    </div>
  </Fold>;
}
