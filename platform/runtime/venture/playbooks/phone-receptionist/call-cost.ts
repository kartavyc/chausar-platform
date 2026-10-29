// Original integer call-leg calculator, informed by floe-guard (MIT), with no copied rates or code.
import {check,digest} from '../../../portable.ts';
import {validDate} from '../../../date-core.ts';
export const CALL_UNITS={telephony:'seconds','speech-to-text':'seconds','model-input':'tokens','model-output':'tokens','text-to-speech':'characters'} as const;
export type CallLeg=keyof typeof CALL_UNITS;
type Unit=typeof CALL_UNITS[CallLeg];
export type CallRate={leg:CallLeg;unit:Unit;perUnits:string;minor:string};
export type CallRates={currency:'INR'|'USD';checkedOn:string;source:string;rates:CallRate[]};
export type CallUsage={callId:string;legs:{leg:CallLeg;unit:Unit;quantity:string}[]};
const fail='Use a complete dated rate table and every measured call leg. Unknown cost is never free.';
function exact(value:unknown,keys:string[]):asserts value is Record<string,unknown>{check(!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(','),'UNPRICED_CALL',fail);}
function integer(value:unknown,positive=false):asserts value is string{check(typeof value==='string'&&/^(0|[1-9][0-9]{0,29})$/.test(value)&&(!positive||BigInt(value)>0n),'UNPRICED_CALL',fail);}
function legOf(value:unknown,unit:unknown):asserts value is CallLeg{check(typeof value==='string'&&Object.hasOwn(CALL_UNITS,value)&&CALL_UNITS[value as CallLeg]===unit,'UNPRICED_CALL',fail);}
/** Owner-entered provider rate snapshot. No bundled price or exchange rate is guessed. */
export function callRateTable(input:unknown,today:string):CallRates{
 exact(input,['currency','checkedOn','source','rates']);check(input.currency==='INR'||input.currency==='USD','UNPRICED_CALL',fail);
 check(validDate(today)&&validDate(input.checkedOn)&&input.checkedOn<=today&&Date.parse(today)-Date.parse(input.checkedOn)<=90*86400000,'UNPRICED_CALL',fail);
 check(typeof input.source==='string'&&input.source.length<=2000,'UNPRICED_CALL',fail);let source:URL|null=null;try{source=new URL(input.source);}catch{}check(source?.protocol==='https:'&&!source.username&&!source.password,'UNPRICED_CALL',fail);
 check(Array.isArray(input.rates)&&input.rates.length===Object.keys(CALL_UNITS).length,'UNPRICED_CALL',fail);const seen=new Set<string>();
 const rates=input.rates.map(raw=>{exact(raw,['leg','unit','perUnits','minor']);legOf(raw.leg,raw.unit);check(!seen.has(raw.leg),'UNPRICED_CALL',fail);seen.add(raw.leg);integer(raw.perUnits,true);integer(raw.minor);return {leg:raw.leg,unit:raw.unit as Unit,perUnits:raw.perUnits,minor:raw.minor};});
 return {currency:input.currency,checkedOn:input.checkedOn,source:input.source,rates};
}
/** Price a complete provider export in its stated currency, rounding each leg up to a minor unit. */
export function priceCall(input:unknown,table:CallRates){
 exact(input,['callId','legs']);check(typeof input.callId==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(input.callId),'UNPRICED_CALL',fail);
 // Revalidate even a caller-created object; the desk separately checks current rate age at intake.
 const rates=callRateTable(table,table.checkedOn);check(Array.isArray(input.legs)&&input.legs.length===rates.rates.length,'UNPRICED_CALL',fail);const seen=new Set<string>();
 const lines=input.legs.map(raw=>{exact(raw,['leg','unit','quantity']);legOf(raw.leg,raw.unit);check(!seen.has(raw.leg),'UNPRICED_CALL',fail);seen.add(raw.leg);integer(raw.quantity);const rate=rates.rates.find(r=>r.leg===raw.leg)!;const product=BigInt(raw.quantity)*BigInt(rate.minor),denominator=BigInt(rate.perUnits),minor=(product+denominator-1n)/denominator;return {leg:raw.leg,unit:raw.unit as Unit,quantity:raw.quantity,rateMinor:rate.minor,perUnits:rate.perUnits,minor:String(minor),rule:'ceil(quantity * rateMinor / perUnits)',checkedOn:rates.checkedOn,source:rates.source};});
 const totalMinor=String(lines.reduce((sum,line)=>sum+BigInt(line.minor),0n));return {callId:input.callId,currency:rates.currency,totalMinor,receipt:{id:'call-cost-'+digest({input,rates}),kind:'call-cost' as const,provenance:'provider-export' as const,lines,totalMinor,currency:rates.currency}};
}
