// SEO4 per-article spend reservations beside the monthly cap. loamwright Apache-2.0 ideas, independent code.
import type {VentureTx} from '../../records.ts';
import {seoNeed} from './content-core.ts';
/** Convert owner-entered dollars to whole microdollars without floating point. */
export function articleLimitMicros(value:unknown):string {seoNeed(typeof value==='string'&&/^(?:0|[1-9]\d{0,5})(?:\.\d{1,6})?$/.test(value),'ARTICLE_LIMIT_REQUIRED','Set a positive article AI limit in US dollars, up to six decimal places.');const [whole,part='']=value.split('.');const result=BigInt(whole!)*1000000n+BigInt(part.padEnd(6,'0'));seoNeed(result>0n,'ARTICLE_LIMIT_REQUIRED','Set a positive article AI limit in US dollars, up to six decimal places.');return String(result);}
/** Resolve the model call to the current delivery order; retries share the same held and settled ledger. */
export function articleReservation(tx:VentureTx,ref:string|null|undefined){
 if(!ref)return null;const run=tx.list('venture-delivery-run').find(run=>run.callId===ref||run.id===ref);if(!run)return null;const order=tx.find('venture-order',run.orderId);const limit=order?.intake?.fields?.articleLimitUsd;if(limit===undefined)return null;
 const cap=articleLimitMicros(limit);let used=0n;for(const spend of tx.list('venture-spend'))if(spend.articleOrderId===order!.id&&(spend.phase==='reserved'||spend.phase==='unknown'||spend.phase==='settled'))used+=BigInt(spend.phase==='settled'?spend.settledMicros??spend.reservedMicros:spend.reservedMicros);
 return {orderId:order!.id,cap,used};
}
