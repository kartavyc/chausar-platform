// Owner reviews exact setup data before exporting a manual bookkeeper handoff.
import {useState} from 'react';
import {useEngine} from '../../../engine/context';
import {useT} from '../../../text';
import {Button} from '../../../parts/Button';
import type {setupDraft} from '../../../../../../platform/runtime/venture/playbooks/bookkeeping-cfo/setup';
import s from './CollectionsDesk.module.css';
export function BooksSetupReview({id,reviewDigest,setup,stale}:{id:string;reviewDigest:string;setup:ReturnType<typeof setupDraft>;stale:boolean}){
 const engine=useEngine(),t=useT(),word=(key:string)=>t('pb-books-finance.'+key);const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[file,setFile]=useState<{name:string;content:string}|null>(null);
 async function exportReview(){if(busy||stale)return;setBusy(true);setFailed(false);setFile(null);try{const answer=await engine.request('venture.desk.act',{playbook:'bookkeeping-cfo',kind:'finance',id,action:'export-setup',digest:reviewDigest,payload:{}});setFile(answer.result as {name:string;content:string});}catch{setFailed(true);}finally{setBusy(false);}}
 return <div className={s.form}><p>{word('setupManual')}</p>{(['customers','vendors','categories'] as const).map(kind=><section key={kind}><h3>{word(kind)}</h3><ul className={s.list}>{setup[kind].map(row=><li className={s.row} key={row.id}><span data-content="">{row.name}</span> <span data-content="">{row.id}</span><p data-content="">{row.source}</p></li>)}</ul></section>)}{failed&&<p role="alert">{word('error.REQUEST_FAILED')}</p>}<Button variant="primary" locked={busy||stale||!reviewDigest} onClick={()=>void exportReview()}>{word('exportSetup')}</Button>{file&&!stale&&<a download={file.name} href={'data:application/json;charset=utf-8,'+encodeURIComponent(file.content)}>{word('downloadSetup')}</a>}</div>;
}
