// F3 explicit linked-client erasure. Original code; no text matching is needed for opaque order links.
import type {VentureDeps} from '../../contracts.ts';import type {VentureTx} from '../../records.ts';import {removeRecords} from '../../network/people.ts';
import {forgetStorefrontSessions} from '../../build/storefront-assistant-memory.ts';
export function eraseShopifyNaming(tx:VentureTx,clientIds:ReadonlySet<string>,named:(value:unknown)=>boolean,secrets?:VentureDeps['secrets']){
 const orders=tx.list('venture-order').filter(order=>(order.sellerShopify||order.sellerStorefront)&&(clientIds.has(order.clientId)||named(order.sellerShopify??null)||named(order.sellerStorefront??null))),receipts=new Set(orders.flatMap(order=>order.sellerShopify?.receiptIds??[])),writes=new Set(orders.flatMap(order=>order.sellerShopify?.writes.map(write=>write.id)??[]));
 for(const order of orders){secrets?.delete(`shopify:${order.ventureId}:${order.id}`);secrets?.delete(`storefront:${order.ventureId}:${order.id}`);forgetStorefrontSessions(secrets,tx.state.workspace.id,order.id);const {sellerShopify:_private,sellerStorefront:_storefront,...rest}=order;tx.replace(rest);}
 // Keep the action outcome but remove the forgotten store/account target and any source-bearing line.
 for(const entry of tx.list('venture-journal-entry'))if(writes.has(entry.subject))tx.replace({...entry,target:'Forgotten store',account:null,line:'Forgotten store operation.',outcome:entry.outcome?{...entry.outcome,line:'Forgotten store operation.',url:null}:null,journal:entry.journal.map(step=>({...step,line:'Forgotten store operation.'}))});
 removeRecords(tx,row=>row.kind==='venture-work-receipt'&&receipts.has(String(row.id)));if(orders.length){tx.emit('desk.changed',{playbook:'online-seller'});tx.emit('queue.changed',{});}
}
