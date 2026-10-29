import {useState} from 'react';
import {useEngine,useResource} from '../../../engine/context';
import {EngineError} from '../../../engine/types';
import {useT} from '../../../text';
import {Tile} from '../../../parts/Tile';
import {Button} from '../../../parts/Button';
import {Figure} from '../../../parts/Figure';
import {openSheet} from '../../../shell/navigation';
import type {BooksPostingBody} from '../../../../../../platform/runtime/venture/playbooks/bookkeeping-cfo/records';
import {SETTLEMENT_PAYMENT_COLUMNS} from '../../../../../../platform/runtime/venture/playbooks/bookkeeping-cfo/settlement-payments';
import s from './CollectionsDesk.module.css';
import p from './BooksPosting.module.css';
const base={playbook:'bookkeeping-cfo' as const,kind:'settlement'};
type Props={id:string;system:'zoho'|'tally';files:readonly {id:string;name:string}[]};
export function BooksSettlement(props:Props){return <SettlementScope key={props.id} {...props}/>;}
function SettlementScope({id,system,files}:Props){
 const engine=useEngine(),t=useT(),word=(key:string)=>t('pb-books-settlement.'+key),[file,setFile]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const detail=useResource('venture.desk.get',{...base,id},{refreshOn:event=>event.type==='desk.changed'}),item=detail.data?.item as BooksPostingBody|undefined,posting=item?.entry.kind==='seller-month'?item.entry.posting:undefined;
 const proof=useResource('venture.work.get',{id:posting?.receiptId??''},{skip:!posting?.receiptId}),locked=busy||detail.loading||!!detail.error||!proof.data||proof.loading||!!proof.error||!!file&&file!==posting?.uploadId;
 async function act(action:'stage'|'apply'|'reconcile'){if(busy||detail.loading||detail.error||!detail.data||action==='apply'&&locked)return;setBusy(true);setError('');try{await engine.request('venture.desk.act',{...base,id,action,payload:action==='stage'?{uploadId:file}:{},...(action==='apply'?{digest:detail.data.digest}:{})});detail.reload();}catch(cause){const code=cause instanceof EngineError?cause.code:'REQUEST_FAILED',text=word('error.'+code);setError(text.startsWith('pb-books-settlement.')?word('error.REQUEST_FAILED'):text);detail.reload();}finally{setBusy(false);}}
 return <details className={p.root}><summary>{word('heading')}</summary><p>{word('boundary')}</p>{system==='tally'?<p>{word('tally')}</p>:<>
  <p>{word('mapping')}</p><p>{word('differences')}</p>{engine.transport==='fake'&&<p role="note">{word('demo')}</p>}
  {(error||detail.error||proof.error)&&<p role="alert" className={s.error}>{error||word('error.REQUEST_FAILED')}</p>}
  {(!posting||posting.state==='staged')&&<Tile><form className={s.form} aria-label={word('prepare')} onSubmit={event=>{event.preventDefault();if(file)void act('stage');}}>
   <a download="books-settlement-blank.csv" href={'data:text/csv;charset=utf-8,'+encodeURIComponent(SETTLEMENT_PAYMENT_COLUMNS.join(',')+'\r\n')}>{word('template')}</a><p>{word('sourceHelp')}</p>
   <label>{word('source')}<select className={s.select} disabled={busy} value={file} onChange={event=>setFile(event.target.value)}><option value="">{word('choose')}</option>{files.map(value=><option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
   <Button type="submit" variant="primary" locked={busy||detail.loading||!!detail.error||!file}>{word('prepare')}</Button>
  </form></Tile>}
  {posting&&<Tile><h3>{word('review')}</h3><p role="status">{word('state.'+posting.state)}</p>{proof.data?.figures.map(figure=><p key={figure.key}><span data-content="">{figure.label}</span> <Figure value={figure.display} receiptId={posting.receiptId} onReceipt={value=>openSheet('work-receipt',value)}/></p>)}
   {posting.prepared.map(value=><details key={value.payment.externalId}><summary>{word('request')} <span data-content="">{value.payment.orderId}</span></summary><pre className={p.code} data-content="">{JSON.stringify({method:value.method,path:value.path,query:value.query},null,2)}</pre><pre className={p.code} data-content="">{value.body}</pre></details>)}
   {posting.state==='staged'&&<Button variant="primary" locked={locked} onClick={()=>void act('apply')}>{word('approve')}</Button>}
   {posting.state==='applying'&&<Button locked={busy||detail.loading||!!detail.error} onClick={()=>void act('reconcile')}>{word('recover')}</Button>}
   {posting.state==='outcome_unknown'&&<p>{word('unknown')}</p>}{posting.state==='stopped'&&<p>{word('stopped')}</p>}
   <ul className={s.list}>{posting.outcomes.map(value=><li className={s.row} key={value.externalId}><span data-content="">{value.externalId}</span> <span>{word('outcome.'+value.state)}</span>{value.remoteId&&<span data-content=""> {value.remoteId}</span>}</li>)}</ul>
  </Tile>}
 </>}</details>;
}
