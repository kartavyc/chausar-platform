// Deterministic customer matching. Ideas from recruitops-agent (MIT); original code for the support desk.
export type MatchCandidate={id:string;email?:string;phone?:string;orderNumber?:string};
/** Email, phone and order evidence are scored in code; a weak or tied result waits for owner confirmation. */
export function matchCustomer(input:Omit<MatchCandidate,'id'>,candidates:readonly MatchCandidate[],floor=65,margin=15):{matchedId:string|null;needsConfirmation:boolean;candidates:{id:string;score:number}[]} {
  const norm=(s:string|undefined)=>s?.trim().toLowerCase(); const phone=(s:string|undefined)=>s?.replace(/\D/g,'');
  const scored=candidates.map(c=>({id:c.id,score:(input.email&&norm(input.email)===norm(c.email)?40:0)+(input.phone&&phone(input.phone)===phone(c.phone)?25:0)+(input.orderNumber&&norm(input.orderNumber)===norm(c.orderNumber)?35:0)})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  const best=scored[0];const matched=best&&best.score>=floor&&best.score-(scored[1]?.score??0)>=margin;
  return {matchedId:matched?best.id:null,needsConfirmation:!matched,candidates:scored};
}

export type ShopCustomerMatch = {matchedId:string|null;needsConfirmation:boolean;candidates:{id:string;score:number;customerId:string;orderNumber:string;file:string;fileId:string;sourceDigest:string}[];confirmedBy?:string|null};
/** Match only customer/order rows supplied for this service order, retaining source identity for owner review. */
export function matchShopRows(input:Omit<MatchCandidate,'id'>,tables:readonly {id:string;name:string;digest:string;rows:readonly {id:string;cells:Record<string,string>}[]}[]):ShopCustomerMatch {
 const candidates=tables.flatMap(table=>table.rows.flatMap(row=>{
  const c=row.cells;return c.customerId?.trim()&&c.orderNumber?.trim()?[{id:`${table.id}:${row.id}`,customerId:c.customerId.trim(),email:c.email?.trim(),phone:c.phone?.trim(),orderNumber:c.orderNumber.trim(),file:table.name,fileId:table.id,sourceDigest:table.digest}]:[];
 }));
 const matched=matchCustomer(input,candidates);return {...matched,candidates:matched.candidates.filter(c=>c.score>0).map(c=>{const source=candidates.find(s=>s.id===c.id)!;return {id:c.id,score:c.score,customerId:source.customerId,orderNumber:source.orderNumber,file:source.file,fileId:source.fileId,sourceDigest:source.sourceDigest};})};
}
