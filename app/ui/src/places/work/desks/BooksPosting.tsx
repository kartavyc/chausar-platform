// Owner accounting approvals. Every displayed amount comes from an engine receipt.
import {useState} from 'react';
import {useEngine,useResource} from '../../../engine/context';
import {EngineError} from '../../../engine/types';
import {useT} from '../../../text';
import {Tile} from '../../../parts/Tile';
import {Button} from '../../../parts/Button';
import {BooksPostingConnection} from './BooksPostingConnection';
import {BooksPostingReview} from './BooksPostingReview';
import type {BooksPostingBody} from '../../../../../../platform/runtime/venture/playbooks/bookkeeping-cfo/records';
import s from './CollectionsDesk.module.css';
import p from './BooksPosting.module.css';
export type BooksPostingProps={orderId:string;cycleId:string;system:'zoho'|'tally';companyId:string;files:readonly {id:string;name:string}[]};
export const postingDesk={playbook:'bookkeeping-cfo' as const,kind:'posting'};
export function BooksPosting(props:BooksPostingProps){return <PostingScope key={props.orderId+'.'+props.cycleId} {...props}/>;}
function PostingScope(props:BooksPostingProps){const t=useT(),word=(key:string)=>t('pb-books-posting.'+key);return <details className={p.root}><summary>{word('heading')}</summary>{props.system==='tally'?<Tile><p>{word('tally')}</p><p>{word('tallyIssue')}</p></Tile>:<PostingZoho {...props}/>}</details>;}
function PostingZoho({orderId,cycleId,companyId,files}:BooksPostingProps){
 const t=useT(),engine=useEngine(),word=(key:string)=>t('pb-books-posting.'+key),[file,setFile]=useState(''),[selected,setSelected]=useState(''),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const connection=useResource('venture.desk.get',{...postingDesk,id:cycleId}),list=useResource('venture.desk.list',{...postingDesk,filter:{cycleId}},{refreshOn:e=>e.type==='desk.changed'}),connected=!!(connection.data?.item as {connected?:boolean}|undefined)?.connected;
 const rows=(list.data?.rows??[]) as (BooksPostingBody&{id:string})[];
 const reload=()=>{connection.reload();list.reload();setRevision(n=>n+1);};
 async function act(action:string,payload:Record<string,unknown>){if(busy)return false;setBusy(true);setError('');try{const result=await engine.request('venture.desk.act',{...postingDesk,id:cycleId,action,payload});if(action==='stage')setSelected(result.id);reload();return true;}catch(cause){const code=cause instanceof EngineError?cause.code:'REQUEST_FAILED',text=word('error.'+code);setError(text.startsWith('pb-books-posting.')?word('error.REQUEST_FAILED'):text);return false;}finally{setBusy(false);}}
 return <div className={p.root}><p>{word('boundary')}</p>{engine.transport==='fake'&&<p role="note">{word('demo')}</p>}{error&&<p className={s.error} role="alert">{error}</p>}{(connection.error||list.error)&&<p role="alert">{word('error.REQUEST_FAILED')}</p>}
  <BooksPostingConnection companyId={companyId} connected={connected} busy={busy} onSave={value=>act('configure-zoho',value)} onDisconnect={()=>act('disconnect',{})}/>
  <Tile><form className={s.form} aria-label={word('prepare')} onSubmit={e=>{e.preventDefault();if(connected&&file&&!busy)void act('stage',{orderId,uploadId:file});}}><label>{word('source')}<select className={s.select} value={file} disabled={busy} onChange={e=>setFile(e.target.value)}><option value="">{word('choose')}</option>{files.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label><Button type="submit" variant="primary" locked={busy||!connected||!file}>{word('prepare')}</Button></form></Tile>
  <ul className={s.list}>{rows.filter(row=>row.entry.kind==='posting').map(row=><li key={row.id}><Button onClick={()=>setSelected(row.id)} locked={busy}>{word('open')} <span data-content="">{row.id}</span></Button></li>)}</ul>
  {selected&&<BooksPostingReview key={selected+'.'+revision} id={selected} connected={connected} onChanged={()=>{list.reload();}}/>}
 </div>;
}
