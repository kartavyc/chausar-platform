// Client debtor ledgers are read from order uploads, never from the service business books.
import { check, type State } from '../../../contracts.ts';
import type { VentureRecord } from '../../contracts.ts';
import { digest, listRecords } from '../../records.ts';
import { readCollectionsSource } from './collections-source-core.ts';
export type CollectionsInvoiceRow = { id:string;clientId:string;clientName:string;serviceOrderId:string;sourceName:string;invoiceId:string;number:string;debtor:string;dueDate:string };
/** Newer uploads with the same name are complete source snapshots, with stable row ids across updates. */
export function collectionSource(state:State,venture:VentureRecord,serviceOrderId:string,sourceName:string){
 const order=listRecords(state,'venture-order',venture.id).find(row=>row.id===serviceOrderId&&row.status!=='cancelled');
 check(order,'CLIENT_LEDGER_REQUIRED','Choose the client service order holding its debtor ledger.');
 const client=listRecords(state,'venture-client',venture.id).find(row=>row.id===order.clientId);
 check(client,'CLIENT_NOT_FOUND','The source client was not found.');
 const upload=listRecords(state,'venture-upload',venture.id).filter(row=>row.scope.kind==='order'&&row.scope.orderId===order.id&&row.name===sourceName).at(-1);
 check(upload?.format==='csv','CLIENT_LEDGER_REQUIRED','Upload the client debtor ledger as CSV on this service order.');
 let source;try{source=readCollectionsSource(Buffer.from(upload.contentBase64,'base64').toString('utf8'));}catch{check(false,'CLIENT_LEDGER_INVALID','The debtor ledger needs valid distinct invoice and payment rows.');}
 check(source,'CLIENT_LEDGER_INVALID','Use columns kind, id, invoice, debtor, on, dueOn, amount and state in the client debtor ledger.');
 return {...source,order,client,upload};
}
/** Only client source invoices appear as collections choices; service-owner invoices are never candidates. */
export function collectionInvoices(state:State,venture:VentureRecord):CollectionsInvoiceRow[]{
 const rows:CollectionsInvoiceRow[]=[];
 for(const order of listRecords(state,'venture-order',venture.id).filter(row=>row.status!=='cancelled')){
  if(!listRecords(state,'venture-client',venture.id).some(row=>row.id===order.clientId))continue;
  const names=[...new Set(listRecords(state,'venture-upload',venture.id).filter(row=>row.scope.kind==='order'&&row.scope.orderId===order.id&&row.format==='csv').map(row=>row.name))];
  for(const name of names){const latest=listRecords(state,'venture-upload',venture.id).filter(row=>row.scope.kind==='order'&&row.scope.orderId===order.id&&row.name===name).at(-1)!;
   let parsed;try{parsed=readCollectionsSource(Buffer.from(latest.contentBase64,'base64').toString('utf8'));}catch{continue;}if(!parsed)continue;
   const source=collectionSource(state,venture,order.id,name);
   for(const invoice of source.invoices)rows.push({id:digest({order:order.id,name,invoice:invoice.id}),clientId:source.client.id,clientName:source.client.name,serviceOrderId:order.id,sourceName:name,invoiceId:invoice.id,number:invoice.number,debtor:invoice.debtor,dueDate:invoice.dueOn});
  }
 }
 return rows;
}
