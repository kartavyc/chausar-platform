import { useId, useState } from 'react';
import { useT } from '../text';
import type { RunDetail } from '../engine/types';
import { ModelEstimate } from './ModelEstimate';
import { Button } from './Button';
import { Figure } from './Figure';
import s from './AgentProgress.module.css';

const TOOLS:Record<string,string>={read_business:'business',read_client:'client',read_order:'order',list_files:'files',read_file:'file',calculate:'calculate',draft_document:'draft',propose_action:'propose',search_records:'search',Read:'file',Write:'write',Edit:'write',Glob:'files',Grep:'search',WebSearch:'web',WebFetch:'page'};

/** Progress is untrusted model text, separate from the checked, receipted deliverable. */
type Decision=(digest:string,decision:'approve'|'deny')=>Promise<void>;
export function AgentProgress({progress,onDecide}:{progress:RunDetail['agentProgress'];onDecide?:Decision|undefined}) {
  const t=useT();
  if(!progress)return null;
  return <>
    {progress.pendingApproval && <PendingStep key={progress.pendingApproval.digest} pending={progress.pendingApproval} onDecide={onDecide}/>}
    {progress.cost && <div className={s.cost}><span>{t('question.costs')}</span>{progress.cost.state==='priced'?<Figure value={progress.cost.display} {...(progress.cost.receiptId?{receiptId:progress.cost.receiptId}:{estimate:true as const})}/>:<span>{progress.cost.display}</span>}</div>}
    {(progress.messages.length>0 || progress.tools.length>0) && <details className={s.progress}>
    <summary className={s.summary}>{t('run.agentUpdates')}</summary>
    <div className={s.stack}>
      {progress.model && <p className={s.model} data-content>{progress.model}</p>}
      {progress.tools.length>0 && <ul className={s.tools} aria-label={t('run.agentTools')}>
        {progress.tools.map(tool=>{
          const key=TOOLS[tool.name.startsWith('mcp__')?tool.name.split('__').at(-1)!:tool.name];
          return <li key={tool.id} className={s.tool}><span>{t(`run.agentTool.${key??'other'}`)}</span><span className={s.status}>{t(`run.agentStatus.${tool.status}`)}</span></li>;
        })}
      </ul>}
      <div className={s.stack} aria-live="polite" aria-relevant="additions text">
        {progress.messages.map(message=><div key={message.id} data-estimate="" data-content className={s.message}><p>{message.text}</p><ModelEstimate/></div>)}
      </div>
    </div>
  </details>}
  </>;
}

function PendingStep({pending,onDecide}:{pending:NonNullable<NonNullable<RunDetail['agentProgress']>['pendingApproval']>;onDecide:Decision|undefined}) {
  const t=useT(),heading=useId();const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  async function decide(decision:'approve'|'deny') {
    if(busy || !onDecide)return;setBusy(true);setError(null);
    try {await onDecide(pending.digest,decision);}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}
  }
  return <section className={s.approval} aria-labelledby={heading} data-card="">
    <h3 id={heading}>{t('run.agentApproval.title')}</h3>
    <p>{t(`run.agentApproval.${pending.request.kind}`)}: <span data-content>{pending.request.name}</span></p>
    {pending.request.description && <p data-content data-estimate="">{pending.request.description}</p>}
    <pre className={s.arguments} data-content data-estimate="">{JSON.stringify(pending.request.arguments,null,2)}</pre>
    <ModelEstimate/>
    {error && <p role="alert">{error}</p>}
    <div className={s.actions}><Button locked={busy||!onDecide} onClick={()=>void decide('deny')}>{t('run.agentApproval.deny')}</Button><Button variant="primary" locked={busy||!onDecide} onClick={()=>void decide('approve')}>{t('run.agentApproval.approve')}</Button></div>
  </section>;
}
