// Chausar seller erasure. Original implementation, including copied receipts and source files.
import type {VentureTx} from '../../records.ts';
import type {VentureDeps} from '../../contracts.ts';
import {eraseShopifyNaming} from './shopify-privacy.ts';
import {removeRecords} from '../../network/people.ts';
/** Forget removes seller evidence about the person and invalidates every dependent approval. */
export function eraseSellerNaming(tx:VentureTx,clientIds:ReadonlySet<string>,handles:ReadonlySet<string>,mentions:(text:unknown)=>boolean,secrets?:VentureDeps['secrets']):void {
 const named=(value:unknown)=>{const text=JSON.stringify(value);return mentions(text)||[...handles].some(handle=>handle.length>=3&&text.toLowerCase().includes(handle.toLowerCase()));};
 eraseShopifyNaming(tx,clientIds,named,secrets);
 const owns=(row:{clientId:string})=>clientIds.has(row.clientId)||named(row);
 const stages=tx.list('venture-seller-stage').filter(owns),movements=tx.list('venture-seller-movement').filter(owns),cases=tx.list('venture-seller-case').filter(owns);
 const ids=new Set([...stages,...movements,...cases].map(row=>row.id));
 const files=new Set(stages.map(row=>row.sourceId));for(const row of cases)for(const id of row.data.attachments)files.add(id);
 const assets=new Set(stages.flatMap(row=>row.stageKind==='photo'?row.imported.map(item=>item.assetId):[]));
 const receipts=new Set(tx.list('venture-work-receipt').filter(row=>'runId' in row.runRef&&ids.has(row.runRef.runId)).map(row=>row.id));
 const digests=new Set(tx.list('venture-asset').filter(row=>assets.has(row.id)).map(row=>row.fileDigest));
 for(const row of tx.list('venture-upload'))if(digests.has(row.digest))files.add(row.id);
 removeRecords(tx,row=>ids.has(String(row.id))||row.kind==='venture-upload'&&files.has(String(row.id))||row.kind==='venture-asset'&&assets.has(String(row.id))||row.kind==='venture-work-receipt'&&receipts.has(String(row.id)));
 if(ids.size)tx.emit('desk.changed',{playbook:'online-seller'});
}
