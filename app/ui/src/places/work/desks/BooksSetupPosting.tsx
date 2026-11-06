// Separate master and opening approvals, exact provider bytes, and code-computed receipt figures.
import {useState} from 'react';
import {useEngine,useResource} from '../../../engine/context';
import {useT} from '../../../text';
import {Button} from '../../../parts/Button';
import {Field} from '../../../parts/Field';
import {Tile} from '../../../parts/Tile';
import {Figure} from '../../../parts/Figure';
import {openSheet} from '../../../shell/navigation';
import type {BooksPostingBody} from '../../../../../../platform/runtime/venture/playbooks/bookkeeping-cfo/records';
import {BooksSetupMappings} from './BooksSetupMappings';
import {BooksSetupConnection} from './BooksSetupConnection';
import s from './CollectionsDesk.module.css';
import p from './BooksPosting.module.css';
type Props={id:string;cycleId:string;system:'zoho'|'tally';stale:boolean};
export function BooksSetupPosting(props:Props){return <SetupScope key={props.id+'.'+props.cycleId} {...props}/>;}
function SetupScope(props:Props){const t=useT(),w=(key:string)=>t('pb-books-setup.'+key);return <details className={p.root}><summary>{w('heading')}</summary>{props.system==='tally'?<p>{w('tally')}</p>:<SetupZoho {...props}/>}</details>;}
function SetupZoho({id,cycleId,stale}:Props){
 const engine=useEngine(),t=useT(),w=(key:string)=>t('pb-books-setup.'+key),[busy,setBusy]=useState(false),[error,setError]=useState(false),[date,setDate]=useState('');
 const detail=useResource('venture.desk.get',{playbook:'bookkeeping-cfo',kind:'setup',id},{refreshOn:e=>e.type==='desk.changed'}),connection=useResource('venture.desk.get',{playbook:'bookkeeping-cfo',kind:'posting',id:cycleId});
 const row=detail.data?.item as (BooksPostingBody&{id:string})|undefined,entry=row?.entry.kind==='setup'?row.entry:undefined,posting=entry?.posting,connected=!!(connection.data?.item as {connected?:boolean}|undefined)?.connected;
 const proof=useResource('venture.work.get',{id:entry?.receiptId??''},{skip:!entry}),locked=busy||stale||!connected||detail.loading||!!detail.error||connection.loading||!!connection.error||proof.loading||!!proof.error||!proof.data||proof.data.id!==entry?.receiptId||row?.id!==id;
 async function act(action:string,payload:Record<string,unknown>={},connect=false){if(busy||(!connect&&action!=='reconcile'&&locked))return;setBusy(true);setError(false);try{await engine.request('venture.desk.act',{playbook:'bookkeeping-cfo',kind:connect?'posting':'setup',id:connect?cycleId:id,action,payload,...(!connect&&action!=='stage-masters'&&action!=='reconcile'?{digest:detail.data?.digest}:{})});detail.reload();connection.reload();}catch{setError(true);}finally{setBusy(false);}}
 return <div className={p.root}><p>{w('boundary')}</p>{engine.transport==='fake'&&<p role="note">{w('demo')}</p>}{(error||detail.error||connection.error||proof.error)&&<p role="alert">{w('error')}</p>}{stale&&<p role="status">{w('stale')}</p>}
 <Tile><BooksSetupConnection busy={busy} connected={connected} onConnect={value=>void act('configure-zoho-account',value,true)} onDisconnect={()=>void act('disconnect',{},true)}/></Tile>
 {entry&&<><Tile><h3>{w('amounts')}</h3>{proof.data?.figures.map(figure=><p key={figure.key}><span data-content="">{figure.label}</span> <Figure value={figure.display} receiptId={entry.receiptId} onReceipt={value=>openSheet('work-receipt',value)}/></p>)}</Tile>
 {!posting&&<Tile><BooksSetupMappings setup={entry.setup} busy={locked} onPrepare={mappings=>void act('stage-masters',{mappings})}/></Tile>}
 {posting&&<><p role="status">{w('state.'+posting.state)}</p><Tile><h3>{w('review')}</h3><ul className={s.list}>{posting.masters.map((master,index)=><li key={index}><p data-content="">{master.input.name}</p><p>{w('master.'+master.state)}</p>{master.record&&<p data-content="">{master.record.id}</p>}<details><summary>{w('request')}</summary><pre className={p.code} data-content="">{JSON.stringify(master.input,null,2)}</pre>{master.prepared&&<><p data-content="">{master.prepared.method+' '+master.prepared.path}</p><pre className={p.code} data-content="">{master.prepared.body}</pre></>}</details></li>)}</ul>{posting.state==='masters-staged'&&<Button variant="primary" locked={locked} onClick={()=>void act('apply-masters')}>{w('approveMasters')}</Button>}</Tile>
 {posting.state==='masters-done'&&<Tile><form className={s.form} aria-label={w('prepareOpening')} onSubmit={e=>{e.preventDefault();if(!locked&&date)void act('stage-opening',{migrationDate:date});}}><p>{w('openingHelp')}</p><Field type="date" label={w('migrationDate')} value={date} disabled={busy} onChange={e=>setDate(e.target.value)}/><Button type="submit" variant="primary" locked={locked||!date}>{w('prepareOpening')}</Button></form></Tile>}
 {posting.opening&&<Tile><h3>{w('opening')}</h3><p data-content="">{posting.opening.method+' '+posting.opening.path}</p><pre className={p.code} data-content="">{posting.opening.body}</pre>{posting.state==='opening-staged'&&<Button variant="primary" locked={locked} onClick={()=>void act('apply-opening')}>{w('approveOpening')}</Button>}{posting.openingId&&<p data-content="">{posting.openingId}</p>}</Tile>}
 {['masters-applying','opening-applying'].includes(posting.state)&&<Tile><p>{w('recoveryHelp')}</p><Button variant="primary" locked={busy} onClick={()=>void act('reconcile')}>{w('recover')}</Button></Tile>}
 {['stopped','outcome_unknown'].includes(posting.state)&&<p>{w('unknown')}</p>}</>}
 </>}
 </div>;
}
