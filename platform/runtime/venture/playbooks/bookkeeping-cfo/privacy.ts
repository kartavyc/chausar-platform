// Original Chausar erasure: finance drafts and approvals cannot retain forgotten client receipt data.
import type {VentureTx} from '../../records.ts';
import {removeRecords} from '../../network/people.ts';
import type {SecretShelf} from '../../contracts.ts';
import {booksSecretName} from './connection-core.ts';
export function eraseBooksNaming(tx:VentureTx,clientIds:ReadonlySet<string>,handles:ReadonlySet<string>,mentions:(text:unknown)=>boolean,secrets?:SecretShelf):void{
 const named=(value:unknown)=>{const text=JSON.stringify(value);return mentions(text)||[...handles].some(handle=>handle.length>=3&&text.toLowerCase().includes(handle.toLowerCase()));};
 const rows=tx.list('venture-books-posting').filter(row=>clientIds.has(row.clientId)||named(row));
 const cycles=new Set(rows.filter(row=>row.entry.kind==='cycle').map(row=>row.cycleId));
 const affected=tx.list('venture-books-posting').filter(row=>rows.some(hit=>hit.id===row.id)||cycles.has(row.cycleId));
 for(const row of affected){const cycle=tx.list('venture-books-posting').find(value=>value.cycleId===row.cycleId&&value.entry.kind==='cycle');if(cycle?.entry.kind==='cycle')secrets?.delete(booksSecretName(row.ventureId,row.clientId,cycle.entry.cycle.companyId));}
 const ids=new Set(affected.map(row=>row.id)),files=new Set(affected.flatMap(row=>row.entry.kind==='voucher'?[row.entry.voucher.receipt.uploadId]:row.entry.kind==='setup'||row.entry.kind==='posting'||row.entry.kind==='seller-month'?[row.entry.uploadId]:[]));
 const receipts=new Set(affected.flatMap(row=>row.entry.kind==='cycle'?[]:[row.entry.receiptId]));
 for(const row of affected)if(row.entry.kind==='seller-month'&&row.entry.posting){files.add(row.entry.posting.uploadId);receipts.add(row.entry.posting.receiptId);}
 // Replaced dry runs retain older receipts for audit until Forget. Remove their own source links too.
 for(const proof of tx.list('venture-work-receipt'))if(proof.runRef.kind==='delivery'&&ids.has(proof.runRef.runId)){receipts.add(proof.id);for(const source of proof.inputs.tables)files.add(source.id);}
 removeRecords(tx,row=>ids.has(String(row.id))||row.kind==='venture-upload'&&files.has(String(row.id))||row.kind==='venture-work-receipt'&&receipts.has(String(row.id)));
 if(ids.size)tx.emit('desk.changed',{playbook:'bookkeeping-cfo'});
}
