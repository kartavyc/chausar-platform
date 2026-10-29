// Original code receipts for explicit currency claims. Reuses the lexical extractor and exact BigInt currency parser.
import {digest} from '../../../portable.ts';
import {decimalMinor,formatMinor} from '../../../currency.ts';
import {extractClaims,type SourceText} from '../../delivery/judge/claim-check-core.ts';
export type TenderMoneyReceipt={id:string;currency:string;minor:string;display:string;sourceId:string;sourceDigest:string;rule:string};
type Amount={text:string;currency:string;minor:string|null};
function amounts(text:string):Amount[]{
 const codes=['INR','USD','EUR','GBP','CAD','AUD','JPY','CNY','CHF','SGD','AED','SAR','HKD','NZD'].map(code=>[...code].map(letter=>'['+letter+letter.toLowerCase()+']').join('')).join('|');
 const scale='lakhs?|crores?|cr|thousand|millions?|billions?|bn|mn|k'.replace(/[a-z]/g,letter=>'['+letter+letter.toUpperCase()+']');
 const tag='(?:[Uu][Ss]\\$|[Rr][Ss]\\.?|[Rr][Uu][Pp][Ee][Ee][Ss]?|रुपये|रुपए|'+codes+'|[A-Z]{3}|\\p{Sc})',number='-?\\d[\\d,]*(?:\\.\\d+)?(?:\\s?(?:'+scale+')\\b)?';
 const pattern=new RegExp(`(?<![\\p{L}\\p{N}])(${tag})\\s*(${number})(?![\\p{L}\\p{N}])|(?<![\\p{L}\\p{N}])(${number})\\s*(${tag})(?![\\p{L}\\p{N}])`,'gu');
 return [...text.matchAll(pattern)].flatMap<Amount>(match=>{
  const label=match[1]??match[4]!,numeric=match[2]??match[3]!;
  if(['ISO','SOC','API'].includes(label))return [];
  const currency=/^(₹|Rs\.?|INR|rupees?|रुपये|रुपए)$/i.test(label)?'INR':/^(US\$|USD|\$)$/i.test(label)?'USD':/^(€|EUR)$/i.test(label)?'EUR':/^(£|GBP)$/i.test(label)?'GBP':null;
  const normalized=numeric.replace(/^-/,'').toLowerCase(),claim=extractClaims(normalized).find(item=>item.kind==='figure'&&item.at===0&&item.text.length===normalized.length);
  try{return [{text:match[0],currency:currency??label,minor:currency&&claim?decimalMinor((numeric.startsWith('-')||text[match.index!-1]==='-'?'-':'')+claim.key,currency):null}];}catch{return [{text:match[0],currency:currency??label,minor:null}];}
 });
}
/** Receipts prove exact transcription from a client quote, not independent price or tax advice. */
export function hasTenderMoney(text:string):boolean{return amounts(text).length>0;}
export function tenderMoneyReceipts(answer:string,documents:readonly SourceText[]):{receipts:TenderMoneyReceipt[];unmatched:string[]}{
 const receipts:TenderMoneyReceipt[]=[],unmatched:string[]=[];
 for(const amount of amounts(answer)){
  const source=amount.minor===null?null:documents.find(doc=>amounts(doc.text).some(candidate=>candidate.currency===amount.currency&&candidate.minor===amount.minor));
  if(!source||amount.minor===null){unmatched.push(amount.text);continue;}
  const body={currency:amount.currency,minor:amount.minor,display:formatMinor(amount.minor,amount.currency),sourceId:source.id,sourceDigest:digest(source.text),rule:'Exact source amount converted to currency minor units with integer arithmetic.'};
  receipts.push({id:'tender_money_'+digest(body),...body});
 }
 return {receipts,unmatched};
}
