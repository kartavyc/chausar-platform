// Chausar deterministic product research. Sorftime MIT ideas, no copied fee guesses or model votes.
import {exact,sellerRows,sellerText,sellerInteger,sellerRefuse} from './operations-core.ts';
export type SellerResearchItem={id:string;title:string;keyword:string;priceMinor:string;feeMinor:string;reviews:string;ratingBps:string;recentReviewSpike:boolean;seasonMonths:number[];source:string};
/** All candidates remain visible; evidence and deterministic verdict precede any model narrative. */
export function reviewSellerShortlist(raw:unknown,options:{month:number;trademarks:string[];profile:string}){
 if(!Number.isInteger(options.month)||options.month<1||options.month>12||!['beginner','grower','pro','factory','brand'].includes(options.profile)||!Array.isArray(options.trademarks))sellerRefuse('SELLER_INPUT_INVALID','Choose a seller profile, month and trademark list.');
 return sellerRows(raw).map(value=>{exact(value,['id','title','keyword','priceMinor','feeMinor','reviews','ratingBps','recentReviewSpike','seasonMonths','source']);const item=value as SellerResearchItem;for(const key of ['id','title','keyword','source'] as const)sellerText(item[key],key);const price=sellerInteger(item.priceMinor,'Price'),fee=sellerInteger(item.feeMinor,'Fee');if(price===0n)sellerRefuse('SELLER_INPUT_INVALID','Research needs a positive price.');sellerInteger(item.reviews,'Reviews');if(sellerInteger(item.ratingBps,'Rating')>500n||typeof item.recentReviewSpike!=='boolean'||!Array.isArray(item.seasonMonths)||item.seasonMonths.some(month=>!Number.isInteger(month)||month<1||month>12))sellerRefuse('SELLER_INPUT_INVALID','Use sourced review and season fields.');
 const badges:string[]=[],evidence:string[]=[item.source];let no=false;
 if(!item.keyword.toLowerCase().split(/\s+/).some(word=>word.length>1&&item.title.toLowerCase().includes(word))){badges.push('off-topic');evidence.push('The title does not contain the requested topic.');no=true;}
 const trademark=options.trademarks.find(word=>word.trim()&&item.title.toLowerCase().includes(word.toLowerCase()));if(trademark||/patent pending/i.test(item.title)){badges.push('trademark');evidence.push('Trademark or IP phrase: '+(trademark??'patent pending'));no=true;}
 if(fee*100n>price*35n){badges.push('fee-share');evidence.push('The supplied fee is more than thirty-five percent of price.');}
 if(item.recentReviewSpike||(BigInt(item.reviews)<10n&&BigInt(item.ratingBps)>=490n)){badges.push('review-anomaly');evidence.push('Review history needs an independent check.');}
 if(item.seasonMonths.length&&!item.seasonMonths.includes(options.month)){badges.push('season');evidence.push('The selected month is outside the supplied season.');}
 return {id:item.id,title:item.title,verdict:no?'NO-GO':badges.length?'CAUTION':'GO',badges,evidence,profile:options.profile,boundary:'This is a sourced shortlist check, not a buying decision.'};});
}
