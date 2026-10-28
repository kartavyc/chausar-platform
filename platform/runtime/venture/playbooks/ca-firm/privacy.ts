// CA12 original privacy boundary: linked packs, workings, receipts and source copies really leave the vault.
import type {VentureTx} from '../../records.ts';import {removeRecords} from '../../network/people.ts';
export function eraseCaNaming(tx:VentureTx,clientIds:ReadonlySet<string>,handles:ReadonlySet<string>,mentions:(text:unknown)=>boolean):void{
 const identifiers=new Set(handles);for(const pack of tx.list('venture-ca-data-pack'))if(clientIds.has(pack.clientId)){if(pack.facts.pan)identifiers.add(pack.facts.pan);if(pack.facts.aadhaar)identifiers.add(pack.facts.aadhaar);}
 const named=(value:unknown)=>{const text=JSON.stringify(value);return mentions(text)||[...identifiers].some(handle=>handle.length>=3&&text.toLowerCase().includes(handle.toLowerCase()));};
 const packs=tx.list('venture-ca-data-pack').filter(row=>clientIds.has(row.clientId)||named(row)),work=tx.list('venture-ca-working').filter(row=>clientIds.has(row.clientId)||named(row)),ids=new Set([...packs,...work].map(row=>row.id)),receipts=new Set([...packs,...work].map(row=>row.receiptId));
 for(const row of tx.list('venture-work-receipt'))if(row.ca&&(named(row)||('runId'in row.runRef&&ids.has(row.runRef.runId))))receipts.add(row.id);
 const tables=new Set(tx.list('venture-work-receipt').filter(row=>receipts.has(row.id)).flatMap(row=>row.inputs.tables.map(t=>t.id))),files=new Set<string>();
 for(const table of tx.list('venture-work-table'))if(tables.has(table.id)&&table.source.kind!=='transform')for(const id of table.source.uploadIds)files.add(id);
 for(const tableId of tables){const upload=tx.find('venture-upload',tableId);if(upload)files.add(upload.id);}
 removeRecords(tx,row=>ids.has(String(row.id))||row.kind==='venture-ca-differential'&&named(row)||row.kind==='venture-work-receipt'&&receipts.has(String(row.id))||row.kind==='venture-work-table'&&tables.has(String(row.id))||row.kind==='venture-upload'&&files.has(String(row.id)));
 if(ids.size)tx.emit('desk.changed',{playbook:'ca-firm'});
}
