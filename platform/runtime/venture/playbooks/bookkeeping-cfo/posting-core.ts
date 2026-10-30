// Original Chausar accounting decisions. Ordered decisions and proportional fitting learn from
// tiktok-shop-netsuite-sync (MIT); its US tax treatment is not used. No IO or write authority lives here.
import { check, ChausarError, digest } from '../../../portable.ts';
import {booksDate} from './books-input.ts';

export type BooksLine = { sku: string; itemId: string | null; amountMinor: string };
export type BooksOrder = {
  shopId: string; orderId: string; source: string; occurredAt: string; timeZone: string;
  status: 'paid' | 'unpaid' | 'held' | 'cancelled'; eligible: boolean; currency: 'INR';
  goodsMinor: string; sellerDiscountMinor: string; platformDiscountMinor: string; subtotalMinor: string;
  shippingMinor: string; taxMinor: string; totalMinor: string; lines: BooksLine[];
};
export type ExistingBooksRecord = { externalId: string; id: string; status: 'draft' | 'issued'; totalMinor: string; recipientId:string|null;materialDigest:string|null;financialDigest:string|null;postingDate:string|null;document:'invoice'|'credit-note';originalId:string|null };
export type PostingDecision = {
  orderId: string; source: string; externalId: string; originalId: string | null; postingDate: string;
  action: 'skip' | 'create-draft' | 'create-refund-draft'; reason: string;
  totalMinor: string; taxMinor: string; shippingMinor: string; lines: BooksLine[]; receiptId: string;
};
const LIMIT=1_000_000_000_000_000n;
function minor(raw: unknown): bigint {
  check(typeof raw==='string' && /^(?:0|[1-9]\d{0,15})$/.test(raw),'BOOKS_MONEY_INVALID','Use exact non-negative paise from the source.');
  const amount=BigInt(raw);check(amount<=LIMIT,'BOOKS_MONEY_INVALID','This amount exceeds the accounting limit.');return amount;
}
function text(raw: unknown, max=200): asserts raw is string {
  check(typeof raw==='string'&&raw.trim().length>0&&raw.length<=max&&!/[\u0000-\u001f]/.test(raw),'BOOKS_INPUT_INVALID','Use a bounded source identity.');
}
function exact(raw: unknown, keys: readonly string[]): void {
  check(raw!==null&&typeof raw==='object'&&!Array.isArray(raw)&&Object.getPrototypeOf(raw)===Object.prototype&&Object.keys(raw).length===keys.length&&keys.every(key=>Object.hasOwn(raw,key)),'BOOKS_INPUT_INVALID','Send the exact accounting source fields.');
}
function validateOrder(order: BooksOrder): void {
  exact(order,['shopId','orderId','source','occurredAt','timeZone','status','eligible','currency','goodsMinor','sellerDiscountMinor','platformDiscountMinor','subtotalMinor','shippingMinor','taxMinor','totalMinor','lines']);
  for(const key of ['shopId','orderId','source'] as const)text(order[key]);
  check(['paid','unpaid','held','cancelled'].includes(order.status)&&typeof order.eligible==='boolean'&&order.currency==='INR','BOOKS_INPUT_INVALID','Choose the source order status and INR currency.');
  postingDay(order.occurredAt,order.timeZone);
  for(const key of ['goodsMinor','sellerDiscountMinor','platformDiscountMinor','subtotalMinor','shippingMinor','taxMinor','totalMinor'] as const)minor(order[key]);
  check(Array.isArray(order.lines)&&order.lines.length>0&&order.lines.length<=200,'BOOKS_INPUT_INVALID','Supply one to two hundred source lines.');
  for(const line of order.lines){exact(line,['sku','itemId','amountMinor']);text(line.sku);if(line.itemId!==null)text(line.itemId);minor(line.amountMinor);}
}

/** Apply a source subtotal proportionally; integer remainder goes to the first largest line, deterministically. */
export function fitLines(weights: readonly string[], targetMinor: string): string[] {
  check(Array.isArray(weights)&&weights.length>0&&weights.length<=200,'BOOKS_MONEY_INVALID','Supply a bounded nonempty line list.');
  const target=minor(targetMinor),values=weights.map(minor),sum=values.reduce((a,b)=>a+b,0n);
  check(sum>0n||target===0n,'BOOKS_MONEY_INVALID','A nonzero total cannot be allocated to zero-value lines.');
  if(sum===0n)return values.map(()=> '0');
  const fitted=values.map(value=>value*target/sum);
  const largest=values.reduce((best,value,index)=>value>values[best]! ? index : best,0);
  fitted[largest]=fitted[largest]!+target-fitted.reduce((a,b)=>a+b,0n);
  return fitted.map(String);
}

/** The source timestamp must carry an offset; the shop's named zone determines its accounting date. */
export function postingDay(timestamp: string,timeZone: string): string {
  text(timestamp,50);text(timeZone,100);
  const match=/^([0-9]{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(timestamp);
  check(match&&!timestamp.startsWith('0000')&&!/^[+-]/.test(timeZone)&&Number.isFinite(Date.parse(timestamp))&&new Date(match[1]+'T00:00:00Z').toISOString().slice(0,10)===match[1],'BOOKS_INPUT_INVALID','Use a real source timestamp and named shop time zone.');
  try{
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone,era:'short',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(timestamp));
    const part=(kind:string)=>parts.find(value=>value.type===kind)!.value;
    const day=`${part('year').padStart(4,'0')}-${part('month')}-${part('day')}`;
    check(part('era')==='AD'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&!day.startsWith('0000'),'BOOKS_INPUT_INVALID','The local posting date must fit a four-digit calendar year.');
    return day;
  }catch{throw new ChausarError('BOOKS_INPUT_INVALID','Choose the shop named time zone.');}
}

/** Shop and source identities are hashed separately from the reversal suffix, avoiding delimiter collisions. */
export function externalPostingId(order: Pick<BooksOrder,'shopId'|'orderId'>): string {
  text(order.shopId);text(order.orderId);return 'chausar-'+digest({shopId:order.shopId,orderId:order.orderId}).slice(0,32);
}

/** Read results are evidence, never an empty collection substituted for a failed or ambiguous lookup. */
export function validateBooksExisting(rows: readonly ExistingBooksRecord[], allowed: ReadonlySet<string>): void {
  check(Array.isArray(rows)&&rows.length<=allowed.size,'BOOKS_READ_FAILED','The books lookup was incomplete or ambiguous.');
  const seen=new Set<string>(),remoteIds=new Set<string>();
  for(const row of rows){
    try{exact(row,['externalId','id','status','totalMinor','recipientId','materialDigest','financialDigest','postingDate','document','originalId']);text(row.id);minor(row.totalMinor);if(row.postingDate!==null)booksDate(row.postingDate);if(row.originalId!==null)text(row.originalId);if(row.recipientId!==null)text(row.recipientId);check(row.materialDigest===null||typeof row.materialDigest==='string'&&/^[a-f0-9]{64}$/.test(row.materialDigest),'BOOKS_READ_FAILED','Read the exact document material fields.');check(['invoice','credit-note'].includes(row.document)&&(row.document!=='invoice'||row.originalId===null),'BOOKS_READ_FAILED','Read the accounting document kind and reversal identity.');check(row.financialDigest===null||typeof row.financialDigest==='string'&&/^[a-f0-9]{64}$/.test(row.financialDigest),'BOOKS_READ_FAILED','Read the original accounting financial details.');}
    catch{throw new ChausarError('BOOKS_READ_FAILED','The books lookup returned an invalid record.');}
    check(allowed.has(row.externalId)&&!seen.has(row.externalId)&&!remoteIds.has(row.id)&&['draft','issued'].includes(row.status),'BOOKS_READ_FAILED','The books lookup returned duplicate or unrelated identities.');seen.add(row.externalId);remoteIds.add(row.id);
  }
}

/** The adapter computes this only from the fetched document lines and actual tax/shipping totals. */
export function booksFinancialDigest(value:Pick<PostingDecision,'totalMinor'|'taxMinor'|'shippingMinor'|'lines'>):string{
  minor(value.totalMinor);minor(value.taxMinor);minor(value.shippingMinor);
  check(Array.isArray(value.lines)&&value.lines.length>0&&value.lines.length<=200,'BOOKS_INPUT_INVALID','Read the complete original accounting lines.');
  return digest({totalMinor:value.totalMinor,taxMinor:value.taxMinor,shippingMinor:value.shippingMinor,lines:value.lines.map(line=>{text(line.itemId);minor(line.amountMinor);return {itemId:line.itemId,amountMinor:line.amountMinor};})});
}

/** Ordered decisions never issue a document, overwrite posted books or infer Indian tax exemptions. */
export function decidePosting(order: BooksOrder,existing: readonly ExistingBooksRecord[]): PostingDecision {
  validateOrder(order);
  const id=externalPostingId(order);validateBooksExisting(existing,new Set([id,id+'-refund']));
  const original=existing.find(row=>row.externalId===id),refund=existing.find(row=>row.externalId===id+'-refund');
  const make=(action:PostingDecision['action'],reason:string):PostingDecision=>{
    const reverses=action==='create-refund-draft';
    const amounts=action==='skip'?order.lines.map(line=>line.amountMinor):fitLines(order.lines.map(line=>line.amountMinor),order.subtotalMinor);
    const body={orderId:order.orderId,source:order.source,externalId:id+(reverses?'-refund':''),originalId:reverses?original!.id:null,postingDate:postingDay(order.occurredAt,order.timeZone),action,reason,totalMinor:order.totalMinor,taxMinor:order.taxMinor,shippingMinor:order.shippingMinor,lines:order.lines.map((line,index)=>({...line,amountMinor:amounts[index]!}))};
    return {...body,receiptId:'books_'+digest({order,existing,body}).slice(0,24)};
  };
  if(!order.eligible)return make('skip','not-eligible');
  if(refund&&(!original||original.status!=='issued'))return make('skip','refund-without-issued-original');
  if(refund&&order.status!=='cancelled')return make('skip','refunded-sale-needs-review');
  if(order.status==='cancelled'&&refund)return make('skip',refund.status==='issued'&&refund.totalMinor===order.totalMinor&&original!.totalMinor===order.totalMinor?'refund-already-posted':'existing-refund-needs-review');
  if(order.status==='cancelled'&&!original)return make('skip','cancelled-before-posting');
  if(order.status==='unpaid'||order.status==='held')return make('skip','not-paid');
  const goods=minor(order.goodsMinor),subtotal=minor(order.subtotalMinor),total=minor(order.totalMinor);
  if(goods-minor(order.sellerDiscountMinor)-minor(order.platformDiscountMinor)!==subtotal||subtotal+minor(order.shippingMinor)+minor(order.taxMinor)!==total)return make('skip','money-does-not-tie');
  if(total===0n)return make('skip','zero-total');
  if(order.lines.some(line=>line.itemId===null))return make('skip','item-not-mapped');
  if(order.lines.every(line=>minor(line.amountMinor)===0n)&&subtotal>0n)return make('skip','money-does-not-tie');
  if(order.status==='cancelled'){
    if(original!.document!=='invoice'||original!.originalId!==null)return make('skip','original-kind-needs-review');
    if(original!.status!=='issued')return make('skip','cancelled-draft-needs-review');
    if(original!.totalMinor!==order.totalMinor)return make('skip','partial-refund-needs-review');
    if(original!.financialDigest===null)return make('skip','original-details-required');
    const proposed=make('create-refund-draft','cancelled-posted-sale');
    if(original!.financialDigest!==booksFinancialDigest(proposed))return make('skip','original-details-differ');
    return proposed;
  }
  if(original)return make('skip',original.totalMinor===order.totalMinor?'already-posted':'existing-record-differs');
  return make('create-draft','paid-unposted-order');
}

/** Build the complete dry run only after one successful existing-record lookup; no truncation and no writes. */
export async function prepareBooksBatch(orders: readonly BooksOrder[],readExisting:(externalIds:readonly string[])=>Promise<readonly ExistingBooksRecord[]>) {
  check(Array.isArray(orders)&&orders.length>0&&orders.length<=200,'BOOKS_INPUT_INVALID','Choose one to two hundred orders in one accounting batch.');
  orders.forEach(validateOrder);
  // A remote read yields control. Keep the exact source bytes whose identities it queried.
  orders=structuredClone(orders);
  const ids=orders.map(externalPostingId);
  check(new Set(ids).size===ids.length,'BOOKS_INPUT_INVALID','Each source order can occur only once in this batch.');
  const allowed=new Set(ids.flatMap(id=>[id,id+'-refund']));
  let existing:readonly ExistingBooksRecord[];
  try{existing=await readExisting([...allowed]);validateBooksExisting(existing,allowed);existing=[...existing].sort((a,b)=>a.externalId<b.externalId?-1:a.externalId>b.externalId?1:0);}
  catch{throw new ChausarError('BOOKS_READ_FAILED','The existing books could not be read. Nothing was proposed or written.');}
  const rows=orders.map((order,index)=>decidePosting(order,existing.filter(row=>row.externalId===ids[index]||row.externalId===ids[index]+'-refund')));
  const total=rows.reduce((sum,row)=>sum+(row.action==='skip'?0n:BigInt(row.totalMinor)*(row.action==='create-refund-draft'?-1n:1n)),0n);
  return {rows,totalMinor:String(total),truncated:false as const,digest:digest({orders,existing,rows})};
}
