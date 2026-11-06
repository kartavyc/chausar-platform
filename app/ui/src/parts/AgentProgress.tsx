import { useId, useState } from 'react';
import { useT } from '../text';
import type { RunDetail } from '../engine/types';
import { ModelEstimate } from './ModelEstimate';
import { Button } from './Button';
import { Figure } from './Figure';
import { Field } from './Field';
import s from './AgentProgress.module.css';
import { Fold } from './Fold';
import { Select } from './Select';

const TOOLS:Record<string,string>={read_business:'business',read_client:'client',read_order:'order',list_files:'files',read_file:'file',calculate:'calculate',draft_document:'draft',propose_action:'propose',search_records:'search',Read:'file',Write:'write',Edit:'write',Glob:'files',Grep:'search',WebSearch:'web',WebFetch:'page'};

/** Progress is untrusted model text, separate from the checked, receipted deliverable. */
type Decision=(digest:string,decision:'approve'|'deny',content?:Record<string,unknown>)=>Promise<void>;
export function AgentProgress({progress,onDecide}:{progress:RunDetail['agentProgress'];onDecide?:Decision|undefined}) {
  const t=useT();
  if(!progress)return null;
  return <>
    {progress.pendingApproval && (progress.pendingApproval.request.kind==='external-input'
      ? <PendingQuestion key={progress.pendingApproval.digest} pending={progress.pendingApproval} onDecide={onDecide}/>
      : <PendingStep key={progress.pendingApproval.digest} pending={progress.pendingApproval} onDecide={onDecide}/>)}
    {progress.unavailableSites && progress.unavailableSites.length>0 && <p className={s.model}>{t('run.sitesUnavailable',{sites:progress.unavailableSites.join(', ')})}</p>}
    {progress.cost && <div className={s.cost}><span>{t('question.costs')}</span>{progress.cost.state==='priced'?<Figure value={progress.cost.display} {...(progress.cost.receiptId?{receiptId:progress.cost.receiptId}:{estimate:true as const})}/>:<span>{progress.cost.display}</span>}</div>}
    {(progress.messages.length>0 || progress.tools.length>0) && <Fold summary={t('run.agentUpdates')} className={s.progress} summaryClassName={s.summary}>
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
  </Fold>}
  </>;
}

type Pending=NonNullable<NonNullable<RunDetail['agentProgress']>['pendingApproval']>;
/** W6 6F9: a code-computed cost on an outside tool card (Sunra), shown with its receipt. Anything else shows no figure. */
function costOf(pending:Pending):{display:string;receiptId:string}|null{
  const cost=pending.request.kind==='external-tool'?(pending.request.arguments as {cost?:unknown}).cost:undefined;
  if(!cost||typeof cost!=='object')return null;
  const {display,receiptId}=cost as {display?:unknown;receiptId?:unknown};
  return typeof display==='string'&&typeof receiptId==='string'&&receiptId.trim()?{display,receiptId}:null;
}
function PendingStep({pending,onDecide}:{pending:Pending;onDecide:Decision|undefined}) {
  const t=useT(),heading=useId();const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);const cost=costOf(pending);
  async function decide(decision:'approve'|'deny') {
    if(busy || !onDecide)return;setBusy(true);setError(null);
    try {await onDecide(pending.digest,decision);}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}
  }
  return <section className={s.approval} aria-labelledby={heading} data-card="">
    <h3 id={heading}>{t('run.agentApproval.title')}</h3>
    <p>{t(`run.agentApproval.${pending.request.kind}`)}: <span data-content>{pending.request.name}</span></p>
    {pending.request.description && <p data-content data-estimate="">{pending.request.description}</p>}
    {cost && <div className={s.cost}><span>{t('run.agentApproval.cost')}</span><Figure value={cost.display} receiptId={cost.receiptId}/></div>}
    <pre className={s.arguments} data-content data-estimate="">{JSON.stringify(pending.request.arguments,null,2)}</pre>
    <ModelEstimate/>
    {error && <p role="alert">{error}</p>}
    <div className={s.actions}><Button locked={busy||!onDecide} onClick={()=>void decide('deny')}>{t('run.agentApproval.deny')}</Button><Button variant="primary" locked={busy||!onDecide} onClick={()=>void decide('approve')}>{t('run.agentApproval.approve')}</Button></div>
  </section>;
}

type FormField={type:'string'|'number'|'integer'|'boolean';title?:string;description?:string;enum?:string[]};
/** W6 6F1: an outside tool server's question (MCP elicitation). The answer goes only to that server, never to the AI. */
function PendingQuestion({pending,onDecide}:{pending:Pending;onDecide:Decision|undefined}) {
  const t=useT(),heading=useId();const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const form=(pending.request.arguments as {fields?:{properties?:Record<string,FormField>}}).fields?.properties??{};
  const [values,setValues]=useState<Record<string,string|boolean>>({});
  async function decide(decision:'approve'|'deny') {
    if(busy || !onDecide)return;setBusy(true);setError(null);
    const content=Object.fromEntries(Object.entries(values).filter(([,value])=>value!=='').map(([key,value])=>{
      const field=form[key];return [key,field&&(field.type==='number'||field.type==='integer')&&typeof value==='string'?Number(value):value];
    }));
    try {await onDecide(pending.digest,decision,decision==='approve'?content:undefined);}catch(problem){setError(problem instanceof Error?problem.message:String(problem));}finally{setBusy(false);}
  }
  return <section className={s.approval} aria-labelledby={heading} data-card="">
    <h3 id={heading}>{t('run.agentApproval.external-input')}</h3>
    <p data-content>{pending.request.name}</p>
    {pending.request.description && <p data-content data-estimate="">{pending.request.description}</p>}
    {Object.entries(form).map(([key,field])=>field.type==='boolean'
      ? <label key={key} className={s.field}><input type="checkbox" checked={values[key]===true} onChange={event=>setValues({...values,[key]:event.currentTarget.checked})}/><span data-content>{field.title??key}</span></label>
      : field.enum
        ? <label key={key} className={s.field}><span data-content>{field.title??key}</span><Select value={String(values[key]??'')} onChange={event=>setValues({...values,[key]:event.currentTarget.value})}><option value=""></option>{field.enum.map(option=><option key={option} value={option}>{option}</option>)}</Select></label>
        : <Field key={key} label={field.title??key} type={field.type==='string'?'text':'number'} value={String(values[key]??'')} onChange={event=>setValues({...values,[key]:event.currentTarget.value})}/>)}
    <ModelEstimate/>
    {error && <p role="alert">{error}</p>}
    <div className={s.actions}><Button locked={busy||!onDecide} onClick={()=>void decide('deny')}>{t('run.agentApproval.deny')}</Button><Button variant="primary" locked={busy||!onDecide} onClick={()=>void decide('approve')}>{t('run.agentApproval.answer')}</Button></div>
  </section>;
}
