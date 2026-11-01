// Chausar playbook kit (wave 6, 6E4): money amounts written in source-bound documents, shared by the tender desk and
// the document desk. Extracted unchanged from tender-desk/money.ts so both desks read amounts the same way: an explicit
// currency tag next to a figure, converted to BigInt minor units by the exact currency parser. Pure: the browser fake
// imports this file too. Written for Chausar; nothing here is learned from an outside source.
import {digest} from '../../../../portable.ts';
import {decimalMinor,formatMinor} from '../../../../currency.ts';
import {extractClaims,type SourceText} from '../../../delivery/judge/claim-check-core.ts';

/** One amount as written: the words, the currency, and its minor units when the currency and figure are exact. */
export type SourceAmount={text:string;currency:string;minor:string|null};
/** A code receipt proving one amount was copied exactly from a client source. */
export type SourceMoneyReceipt={id:string;currency:string;minor:string;display:string;sourceId:string;sourceDigest:string;rule:string};

/** Every amount in a text with an explicit currency tag before or after the figure. */
export function moneyAmounts(text:string):SourceAmount[]{
 const codes=['INR','USD','EUR','GBP','CAD','AUD','JPY','CNY','CHF','SGD','AED','SAR','HKD','NZD'].map(code=>[...code].map(letter=>'['+letter+letter.toLowerCase()+']').join('')).join('|');
 const scale='lakhs?|crores?|cr|thousand|millions?|billions?|bn|mn|k'.replace(/[a-z]/g,letter=>'['+letter+letter.toUpperCase()+']');
 const tag='(?:[Uu][Ss]\\$|[Rr][Ss]\\.?|[Rr][Uu][Pp][Ee][Ee][Ss]?|रुपये|रुपए|'+codes+'|[A-Z]{3}|\\p{Sc})',number='-?\\d[\\d,]*(?:\\.\\d+)?(?:\\s?(?:'+scale+')\\b)?';
 const pattern=new RegExp(`(?<![\\p{L}\\p{N}])(${tag})\\s*(${number})(?![\\p{L}\\p{N}])|(?<![\\p{L}\\p{N}])(${number})\\s*(${tag})(?![\\p{L}\\p{N}])`,'gu');
 return [...text.matchAll(pattern)].flatMap<SourceAmount>(match=>{
  const label=match[1]??match[4]!,numeric=match[2]??match[3]!;
  if(['ISO','SOC','API'].includes(label))return [];
  const currency=/^(₹|Rs\.?|INR|rupees?|रुपये|रुपए)$/i.test(label)?'INR':/^(US\$|USD|\$)$/i.test(label)?'USD':/^(€|EUR)$/i.test(label)?'EUR':/^(£|GBP)$/i.test(label)?'GBP':null;
  const normalized=numeric.replace(/^-/,'').toLowerCase(),claim=extractClaims(normalized).find(item=>item.kind==='figure'&&item.at===0&&item.text.length===normalized.length);
  try{return [{text:match[0],currency:currency??label,minor:currency&&claim?decimalMinor((numeric.startsWith('-')||text[match.index!-1]==='-'?'-':'')+claim.key,currency):null}];}catch{return [{text:match[0],currency:currency??label,minor:null}];}
 });
}

/** True when the text writes any amount with a currency tag. */
export function hasMoney(text:string):boolean{return moneyAmounts(text).length>0;}

/** Receipts prove exact transcription from a client source, not independent price or tax advice. prefix names the desk. */
export function sourceMoneyReceipts(answer:string,documents:readonly SourceText[],prefix:string):{receipts:SourceMoneyReceipt[];unmatched:string[]}{
 const receipts:SourceMoneyReceipt[]=[],unmatched:string[]=[];
 for(const amount of moneyAmounts(answer)){
  const source=amount.minor===null?null:documents.find(doc=>moneyAmounts(doc.text).some(candidate=>candidate.currency===amount.currency&&candidate.minor===amount.minor));
  if(!source||amount.minor===null){unmatched.push(amount.text);continue;}
  const body={currency:amount.currency,minor:amount.minor,display:formatMinor(amount.minor,amount.currency),sourceId:source.id,sourceDigest:digest(source.text),rule:'Exact source amount converted to currency minor units with integer arithmetic.'};
  receipts.push({id:prefix+digest(body),...body});
 }
 return {receipts,unmatched};
}
