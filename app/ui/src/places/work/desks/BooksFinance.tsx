// Original owner finance view. The engine computes and formats every amount and binds exact approvals.
import {useRef,useState} from 'react';
import {useEngine,useResource} from '../../../engine/context';
import {EngineError} from '../../../engine/types';
import {useT} from '../../../text';
import {Tile} from '../../../parts/Tile';
import {Field} from '../../../parts/Field';
import {Button} from '../../../parts/Button';
import {Figure} from '../../../parts/Figure';
import {openSheet} from '../../../shell/navigation';
import type {BooksPostingBody} from '../../../../../../platform/runtime/venture/playbooks/bookkeeping-cfo/records';
import s from './CollectionsDesk.module.css';
import f from './BooksFinance.module.css';
import {BooksSettlement} from './BooksSettlement';
import {BooksSellerMonth} from './BooksSellerMonth';
import {BooksSetupReview} from './BooksSetupReview';
import {BooksSetupPosting} from './BooksSetupPosting';
import {BooksPosting} from './BooksPosting';
import {SETUP_COLUMNS} from '../../../../../../platform/runtime/venture/playbooks/bookkeeping-cfo/setup-source';
import {BOOKS_SOURCE_COLUMNS} from '../../../../../../platform/runtime/venture/playbooks/bookkeeping-cfo/posting-source';
import {SELLER_BOOKS_COLUMNS} from '../../../../../../platform/runtime/venture/playbooks/bookkeeping-cfo/seller-books-source';
type Row=BooksPostingBody&{id:string;stale:boolean;amounts:{accountId:string;debit:string;credit:string}[];figures?:{key:string;label:string;display:string}[]};
const base={playbook:'bookkeeping-cfo' as const,kind:'finance'};
export function BooksFinance(){
 const t=useT(),engine=useEngine(),word=(key:string)=>t('pb-books-finance.'+key);
 const [orderId,setOrder]=useState(''),[cycleId,setCycle]=useState(''),[selected,setSelected]=useState(''),[fileId,setFile]=useState('');
 const [company,setCompany]=useState(''),[system,setSystem]=useState('tally'),[from,setFrom]=useState(''),[to,setTo]=useState('');
 const [date,setDate]=useState(''),[description,setDescription]=useState(''),[debit,setDebit]=useState(''),[credit,setCredit]=useState(''),[amount,setAmount]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),scope=useRef(0),generation=scope.current;
 const leaveScope=()=>{scope.current++;setBusy(false);setError('');setSelected('');};
 const orders=useResource('venture.order.list',{}),cycles=useResource('venture.desk.list',base,{refreshOn:e=>e.type==='desk.changed'});
 const files=useResource('venture.files.list',{orderId},{skip:!orderId}),list=useResource('venture.desk.list',{...base,filter:{cycleId}},{skip:!cycleId,refreshOn:e=>e.type==='desk.changed'});
 const detail=useResource('venture.desk.get',{...base,id:selected},{skip:!selected,refreshOn:e=>e.type==='desk.changed'}),loadedItem=detail.data?.item as Row|undefined;
 async function act(action:string,payload:Record<string,string|{accountId:string;debitRupees:string;creditRupees:string}[]>,id='new'){
  if(busy)return;const started=scope.current;setBusy(true);setError('');try{const result=await engine.request('venture.desk.act',{...base,id,action,payload,...(id==='new'?{}:{digest:detail.data?.digest})});if(scope.current!==started)return;if(action==='create-cycle')setCycle(result.id);else setSelected(result.id);cycles.reload();list.reload();detail.reload();}catch(cause){if(scope.current!==started)return;const key=cause instanceof EngineError?cause.code:'REQUEST_FAILED',text=word('error.'+key);setError(text==='pb-books-finance.error.'+key?word('error.REQUEST_FAILED'):text);}finally{if(scope.current===started)setBusy(false);}
 }
 const cycleRows=(cycles.data?.rows??[]) as Row[];
 const selectedOrder=orders.data?.find(row=>row.id===orderId),ownCycles=cycleRows.filter(row=>row.clientId===selectedOrder?.clientId&&row.entry.kind==='cycle'),activeCycle=ownCycles.find(row=>row.id===cycleId);
 const inScope=(row:Row)=>!!activeCycle&&row.clientId===selectedOrder?.clientId&&row.cycleId===activeCycle.cycleId;
 const workRows=((list.data?.rows??[]) as Row[]).filter(inScope),item=loadedItem?.id===selected&&inScope(loadedItem)?loadedItem:undefined;
 return <details className={f.root}><summary>{word('heading')}</summary><p className={s.boundary}>{word('boundary')}</p>{error&&<p role="alert" className={s.error}>{error}</p>}
  <details><summary>{word('templates')}</summary><p>{word('templateHelp')}</p><ul>{[['setup',SETUP_COLUMNS],['posting',BOOKS_SOURCE_COLUMNS],['monthly',SELLER_BOOKS_COLUMNS]].map(([key,columns])=><li key={String(key)}><a download={'books-'+key+'-blank.csv'} href={'data:text/csv;charset=utf-8,'+encodeURIComponent((columns as readonly string[]).join(',')+'\r\n')}>{word(key+'Template')}</a></li>)}</ul><p>{t('pb-books-finance.setupHelp',{kinds:'customer, vendor, category, opening'})}</p><p>{t('pb-books-finance.monthlyHelp',{kinds:'order, settlement, fee-slab, weight-change, return-deduction, hold, gst, tcs, tds'})}</p></details>
  <label>{word('order')}<select className={s.select} value={orderId} onChange={e=>{leaveScope();setOrder(e.target.value);setFile('');setCycle('');setSelected('');}}><option value="">{word('choose')}</option>{orders.data?.map(row=><option key={row.id} value={row.id}>{row.request}</option>)}</select></label>
  <label>{word('cycle')}<select className={s.select} value={cycleId} onChange={e=>{leaveScope();setCycle(e.target.value);setSelected('');}}><option value="">{word('choose')}</option>{ownCycles.map(row=>row.entry.kind==='cycle'&&<option key={row.id} value={row.id}>{t('pb-books-finance.cycleLabel',{company:row.entry.cycle.companyId,system:word(row.entry.cycle.system),from:row.entry.cycle.from,to:row.entry.cycle.to})}</option>)}</select></label>
  <Tile><form aria-label={word('create')} className={s.form} onSubmit={e=>{e.preventDefault();void act('create-cycle',{orderId,system,companyId:company,from,to});}}>
   <label>{word('system')}<select className={s.select} value={system} onChange={e=>setSystem(e.target.value)}><option value="tally">{word('tally')}</option><option value="zoho">{word('zoho')}</option></select></label>
   <Field label={word('company')} value={company} onChange={e=>setCompany(e.target.value)}/><Field type="date" label={word('from')} value={from} onChange={e=>setFrom(e.target.value)}/><Field type="date" label={word('to')} value={to} onChange={e=>setTo(e.target.value)}/>
   <Button type="submit" variant="primary" locked={busy||!orderId||!company||!from||!to}>{word('create')}</Button>
  </form></Tile>
  {cycleId&&<Tile><form aria-label={word('draft')} className={s.form} onSubmit={e=>{e.preventDefault();void act('draft-voucher',{cycleId,orderId,receiptUploadId:fileId,date,description,lines:[{accountId:debit,debitRupees:amount,creditRupees:'0'},{accountId:credit,debitRupees:'0',creditRupees:amount}]});}}>
   <label>{word('file')}<select className={s.select} value={fileId} onChange={e=>setFile(e.target.value)}><option value="">{word('choose')}</option>{files.data?.map(file=><option key={file.id} value={file.id}>{file.name}</option>)}</select></label>
   <Field type="date" label={word('date')} value={date} onChange={e=>setDate(e.target.value)}/><Field label={word('description')} value={description} onChange={e=>setDescription(e.target.value)}/>
   <Field label={word('debitAccount')} value={debit} onChange={e=>setDebit(e.target.value)}/><Field label={word('creditAccount')} value={credit} onChange={e=>setCredit(e.target.value)}/><Field label={word('amount')} inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/>
   <Button type="submit" variant="primary" locked={busy||!fileId||!date||!description||!debit||!credit||!amount}>{word('draft')}</Button>
   <Button locked={busy||!fileId} onClick={()=>void act('draft-setup',{cycleId,orderId,uploadId:fileId})}>{word('setup')}</Button>
  </form></Tile>}
  {cycleId&&<BooksSellerMonth key={orderId+'.'+cycleId} orderId={orderId} cycleId={cycleId} files={files.data??[]} onSaved={id=>{if(scope.current!==generation)return;setSelected(id);list.reload();detail.reload();}}/>}
  {cycleId&&ownCycles.map(row=>row.id===cycleId&&row.entry.kind==='cycle'?<BooksPosting key={orderId+'.'+cycleId} orderId={orderId} cycleId={cycleId} system={row.entry.cycle.system} companyId={row.entry.cycle.companyId} files={files.data??[]}/>:null)}
  <ul className={s.list}>{workRows.filter(row=>row.entry.kind!=='cycle'&&row.entry.kind!=='posting').map(row=><li key={row.id}><Button onClick={()=>setSelected(row.id)}>{word(row.entry.kind==='voucher'?'voucher':row.entry.kind==='seller-month'?'monthly':'setupReview')}</Button></li>)}</ul>
  {item?.entry.kind==='setup'&&<BooksSetupPosting id={item.id} cycleId={cycleId} system={item.entry.setup.cycle.system} stale={item.stale}/>}
  {item&&item.entry.kind!=='cycle'&&item.entry.kind!=='posting'&&<Tile><p data-content="">{item.entry.kind==='voucher'?item.entry.voucher.description:word(item.entry.kind==='seller-month'?'monthly':'setupReview')}</p>{item.stale&&<p role="status">{word('stale')}</p>}
   <ul className={s.list}>{item.amounts.map((row,index)=><li className={s.row} key={index}><span data-content="">{row.accountId}</span><span>{word('debit')} <Figure value={row.debit} receiptId={item.entry.kind==='cycle'?'':item.entry.receiptId} onReceipt={id=>openSheet('work-receipt',id)}/></span><span>{word('credit')} <Figure value={row.credit} receiptId={item.entry.kind==='cycle'?'':item.entry.receiptId} onReceipt={id=>openSheet('work-receipt',id)}/></span></li>)}</ul>
   {item.entry.kind==='setup'&&<BooksSetupReview key={item.id+'.'+detail.data?.digest} id={item.id} reviewDigest={detail.data?.digest??''} setup={item.entry.setup} stale={item.stale}/>}
   {item.entry.kind==='voucher'&&(item.entry.voucher.state==='approved'&&!item.stale?<p role="status">{word('approved')}</p>:<Button variant="primary" locked={busy||item.stale} onClick={()=>void act('approve-voucher',{},item.id)}>{word('approve')}</Button>)}
   {item.entry.kind==='seller-month'&&<>{activeCycle?.entry.kind==='cycle'&&<BooksSettlement key={item.id} id={item.id} system={activeCycle.entry.cycle.system} files={files.data??[]}/>}<p>{word('taxReview')}</p><ul className={s.list}>{item.figures?.map(row=><li className={s.row} key={row.key}><span>{word(row.key.startsWith('credit-')?'creditDifference':'payoutDifference')}</span><span data-content="">{row.label}</span><Figure value={row.display} receiptId={item.entry.kind==='seller-month'?item.entry.receiptId:''} onReceipt={id=>openSheet('work-receipt',id)}/></li>)}</ul></>}
  </Tile>}
 </details>;
}
