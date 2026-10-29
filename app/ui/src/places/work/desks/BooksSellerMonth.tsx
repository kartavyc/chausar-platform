// Monthly source reconciliation uses the existing seller engine and opens its code receipts.
import {useState} from 'react';
import {useEngine} from '../../../engine/context';
import {EngineError} from '../../../engine/types';
import {useT} from '../../../text';
import {Tile} from '../../../parts/Tile';
import {Field} from '../../../parts/Field';
import {Button} from '../../../parts/Button';
import s from './CollectionsDesk.module.css';
export function BooksSellerMonth({orderId,cycleId,files,onSaved}:{orderId:string;cycleId:string;files:{id:string;name:string}[];onSaved:(id:string)=>void}){
 const engine=useEngine(),t=useT(),word=(key:string)=>t('pb-books-finance.'+key),[file,setFile]=useState(''),[month,setMonth]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function run(){if(busy)return;setBusy(true);setError('');try{const result=await engine.request('venture.desk.act',{playbook:'bookkeeping-cfo',kind:'finance',id:'new',action:'monthly-seller',payload:{orderId,cycleId,uploadId:file,month}});onSaved(result.id);}catch(cause){const key=cause instanceof EngineError?cause.code:'REQUEST_FAILED',text=word('error.'+key);setError(text.startsWith('pb-books-finance.')?word('error.REQUEST_FAILED'):text);}finally{setBusy(false);}}
 return <Tile><form aria-label={word('monthly')} className={s.form} onSubmit={e=>{e.preventDefault();void run();}}><h3>{word('monthly')}</h3>{error&&<p role="alert" className={s.error}>{error}</p>}
  <label>{word('monthlyFile')}<select className={s.select} value={file} onChange={e=>setFile(e.target.value)}><option value="">{word('choose')}</option>{files.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
  <Field type="month" label={word('month')} value={month} onChange={e=>setMonth(e.target.value)}/><Button type="submit" variant="primary" locked={busy||!file||!month}>{word('reconcile')}</Button>
 </form></Tile>;
}
