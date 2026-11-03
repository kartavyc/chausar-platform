// Chausar playbook: the sign-off desk (wave 6, 6E5). Forget removes a client's sign-off requests with what was sent
// and decided on them. The professional of record is the business's own record and stays. Exact owner Forget only.
import type {VentureTx} from '../../records.ts';
import {removeRecords} from '../../network/people.ts';
export function eraseSignoffNaming(tx:VentureTx,clientIds:ReadonlySet<string>,handles:ReadonlySet<string>,mentions:(value:unknown)=>boolean){
 const named=(value:unknown)=>{const text=JSON.stringify(value)??'';return mentions(text)||[...handles].some(h=>h.length>=3&&text.toLowerCase().includes(h.toLowerCase()));};
 const requests=new Set(tx.list('venture-signoff').filter(row=>row.entry==='request'&&(clientIds.has(row.clientId)||named(row))).map(row=>row.id));
 if(!requests.size)return;
 removeRecords(tx,record=>record.kind==='venture-signoff'&&(requests.has(String(record.id))||('requestId' in record&&requests.has(String(record.requestId)))));
 tx.emit('desk.changed',{playbook:'signoff-desk'});
}
