// Chausar playbook: the document desk (wave 6, 6E4). Forget removes a client's documents: every section, outline and
// figures table of an order whose client is forgotten or whose words name them. Only the exact owner Forget calls it.
import type {VentureTx} from '../../records.ts';
import {removeRecords} from '../../network/people.ts';
export function eraseDocumentNaming(tx:VentureTx,clientIds:ReadonlySet<string>,handles:ReadonlySet<string>,mentions:(value:unknown)=>boolean){
 const named=(value:unknown)=>{const text=JSON.stringify(value)??'';return mentions(text)||[...handles].some(h=>h.length>=3&&text.toLowerCase().includes(h.toLowerCase()));};
 const ids=new Set(tx.list('venture-document').filter(row=>clientIds.has(row.clientId)||named(row)).map(row=>row.id));
 if(!ids.size)return;
 removeRecords(tx,record=>record.kind==='venture-document'&&ids.has(String(record.id)));
 tx.emit('desk.changed',{playbook:'document-desk'});
}
