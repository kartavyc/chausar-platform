// Exact reviewed provider bytes, separate draft/issue actions, and no retry for uncertain outcomes.
import {useState} from 'react';
import {useEngine,useResource} from '../../../engine/context';
import {EngineError} from '../../../engine/types';
import {useT} from '../../../text';
import {Tile} from '../../../parts/Tile';
import {Button} from '../../../parts/Button';
import {Figure} from '../../../parts/Figure';
import {openSheet} from '../../../shell/navigation';
import type {BooksPostingBody} from '../../../../../../platform/runtime/venture/playbooks/bookkeeping-cfo/records';
import s from './CollectionsDesk.module.css';
import p from './BooksPosting.module.css';
const base={playbook:'bookkeeping-cfo' as const,kind:'posting'};
export function BooksPostingReview({id,connected,onChanged}:{id:string;connected:boolean;onChanged:()=>void}){
 const engine=useEngine(),t=useT(),word=(key:string)=>t('pb-books-posting.'+key),[busy,setBusy]=useState(false),[error,setError]=useState(''),detail=useResource('venture.desk.get',{...base,id},{refreshOn:e=>e.type==='desk.changed'}),row=detail.data?.item as (BooksPostingBody&{id:string})|undefined;
 const receiptId=row?.entry.kind==='posting'?row.entry.receiptId:'',receipt=useResource('venture.work.get',{id:receiptId},{skip:!receiptId});
 async function act(action:string,payload:Record<string,string>={}){if(busy||detail.loading||detail.error||!detail.data||(['apply','issue'].includes(action)&&(!receipt.data||receipt.loading||receipt.error)))return;setBusy(true);setError('');try{await engine.request('venture.desk.act',{...base,id,action,payload,...(action==='reconcile'?{}:{digest:detail.data.digest})});detail.reload();onChanged();}catch(cause){const code=cause instanceof EngineError?cause.code:'REQUEST_FAILED',text=word('error.'+code);setError(text.startsWith('pb-books-posting.')?word('error.REQUEST_FAILED'):text);detail.reload();}finally{setBusy(false);}}
 if(!row||row.entry.kind!=='posting')return <p role="status">{word(detail.error?'error.REQUEST_FAILED':'loading')}</p>;
 const entry=row.entry,locked=busy||detail.loading||!!detail.error||!connected||!receipt.data||receipt.loading||!!receipt.error;
 return <div className={p.root}>{error&&<p role="alert" className={s.error}>{error}</p>}<Tile><h3>{word('review')}</h3><p role="status">{word('state.'+entry.state)}</p>{receipt.data?.figures.map(figure=><p key={figure.key}><span data-content="">{figure.label}</span> <Figure value={figure.display} receiptId={entry.receiptId} onReceipt={value=>openSheet('work-receipt',value)}/></p>)}{receipt.error&&<p role="alert">{word('error.REQUEST_FAILED')}</p>}
  {entry.batch.rows.map(decision=><div className={s.row} key={decision.externalId}><span data-content="">{decision.orderId}</span><span data-content="">{decision.source}</span><span>{word('action.'+decision.action)}</span><span>{word('reason.'+decision.reason)}</span><details><summary>{word('sourceDetails')}</summary><pre className={p.code} data-content="">{JSON.stringify(decision,null,2)}</pre></details>{entry.prepared.filter(value=>value.decision.externalId===decision.externalId).map(value=><details key={value.digest}><summary>{word('requestDetails')}</summary><p>{word('aggregate')}</p><pre className={p.code} data-content="">{JSON.stringify({method:value.method,path:value.path,query:value.query,mapping:value.mapping},null,2)}</pre><pre className={p.code} data-content="">{value.body}</pre></details>)}</div>)}
  {entry.state==='staged'&&<Button variant="primary" locked={locked} onClick={()=>void act('apply')}>{word('apply')}</Button>}
  {entry.state==='drafted'&&<Button locked={locked} onClick={()=>void act('refresh-connection')}>{word('refresh')}</Button>}
  {['applying','issuing'].includes(entry.state)&&<Button locked={busy||detail.loading} onClick={()=>void act('reconcile')}>{word('recover')}</Button>}
  {entry.state==='outcome_unknown'&&<p>{word('unknown')}</p>}{entry.state==='stopped'&&<p>{word('stopped')}</p>}
 </Tile>{entry.outcomes.map(outcome=><Tile key={outcome.externalId}><p data-content="">{outcome.externalId}</p><p>{word('outcome.'+outcome.state)}</p>{outcome.remoteId&&<p data-content="">{outcome.remoteId}</p>}{entry.state==='drafted'&&outcome.state==='drafted'&&<><p>{word('issueHelp')}</p><Button variant="primary" locked={locked} onClick={()=>void act('issue',{externalId:outcome.externalId})}>{word('issue')}</Button></>}</Tile>)}</div>;
}
