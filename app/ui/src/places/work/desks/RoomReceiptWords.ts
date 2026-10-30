// Translate only complete, known system templates. Values and unknown evidence stay verbatim.
import en from '../../../text/en/room-receipt.json';
import type {T} from '../../../text';
import type {PriceFigureLite,ReceiptLite,RoutineSchedule} from '../../../engine/types';
const words=en as Record<string,string>;
const keyFor=(text:string,keys:readonly string[])=>keys.find(key=>words['room-receipt.'+key]===text);
const labels=['subtotal','subtotalBeforeTax','discount','taxable','tax','total','gstTotal','zeroExport'] as const;
const rules=['multiply','discountRule','taxableRule','none','single','split','splitSum','igst','lut','totalRule'] as const;
export function roomReceiptLabel(t:T,figure:PriceFigureLite):string {
 const label=figure.label,key=keyFor(label,labels);if(key)return t('room-receipt.'+key);
 if(['TAXABLE','TAX','CGST','SGST','IGST'].includes(label))return label==='TAXABLE'?t('room-receipt.taxable'):label==='TAX'?t('room-receipt.tax'):label;
 const unit=/^Price per (month|project|hour)(?:, (GST|VAT|Tax) included)?$/.exec(label);
 if(unit){const name=t('room-receipt.unit.'+unit[1]);return unit[2]?t('room-receipt.included',{label:name,tax:unit[2]}):name;}
 const rate=/^(GST|CGST|SGST|IGST|VAT|Tax) at (\d+(?:\.\d+)?)%$/.exec(label);
 return rate?t('room-receipt.rate',{tax:rate[1]!,rate:rate[2]!}):label;
}
export function roomReceiptCalculation(t:T,receipt:ReceiptLite):string|null {
 // Browser rehearsal receipts serialize the existing code steps; never evaluate the arithmetic here.
 const steps=receipt.explanation.split('. '),translated=steps.map(step=>{
  const match=/^(.+); inputs: (\d+(?:, \d+)*); result: (\d+) minor units$/.exec(step);
  if(!match)return null;const key=keyFor(match[1]!,rules);
  return key?t('room-receipt.step',{rule:t('room-receipt.'+key),inputs:match[2]!,result:match[3]!}):null;
 });
 if(translated.length&&translated.every(value=>value!==null))return translated.join('. ');
 // Native receipts carry a compact sentence. Bind its amounts to the supplied receipt figures.
 const assumption=' Place of supply taken as your own state.',assumed=receipt.explanation.endsWith(assumption),explanation=assumed?receipt.explanation.slice(0,-assumption.length):receipt.explanation,withPlace=(text:string)=>text+(assumed?' '+t('room-receipt.assumedState'):'');
 const match=/^(\d+) x (month|project|hour) at ([A-Z]{3} \d+(?:,\d+)*(?:\.\d+)?)(.*)$/.exec(explanation);
 if(!match)return null;const figure=(key:string)=>receipt.figures.find(f=>f.key===key)?.display;
 if(match[3]!==figure('unit')||!figure('total'))return null;
 const base=t('room-receipt.nativeBase',{quantity:match[1]!,unit:t('room-receipt.unitName.'+match[2]),price:match[3]!}),total=figure('total')!;
 if(match[4]===` = ${total}.`)return withPlace(t('room-receipt.nativeTotal',{base,total}));
 const tax=/^, plus (GST|VAT|Tax|IGST) at (\d+(?:\.\d+)?)% \(([A-Z]{3} \d+(?:,\d+)*(?:\.\d+)?)\) = ([A-Z]{3} \d+(?:,\d+)*(?:\.\d+)?)\.$/.exec(match[4]!);
 if(tax&&tax[3]===figure(tax[1]==='IGST'?'igst':'tax')&&tax[4]===total)return withPlace(t('room-receipt.nativeTax',{base,tax:tax[1]!,rate:tax[2]!,amount:tax[3]!,total}));
 const split=/^, plus CGST at (\d+(?:\.\d+)?)% \(([A-Z]{3} \d+(?:,\d+)*(?:\.\d+)?)\) and SGST at (\d+(?:\.\d+)?)% \(([A-Z]{3} \d+(?:,\d+)*(?:\.\d+)?)\) = ([A-Z]{3} \d+(?:,\d+)*(?:\.\d+)?)\.$/.exec(match[4]!);
 if(split&&split[2]===figure('cgst')&&split[4]===figure('sgst')&&split[5]===total)return withPlace(t('room-receipt.nativeSplit',{base,cgstRate:split[1]!,cgst:split[2]!,sgstRate:split[3]!,sgst:split[4]!,total}));
 return null;
}
export function vaScheduleWords(t:T,schedule:RoutineSchedule,fallback:string):string {
 if(schedule.kind!=='calendar')return fallback;
 const days=schedule.weekdays.length===7?t('business.routines.everyDay'):schedule.weekdays.map(day=>t('business.routines.day.'+day)).join(', ');
 return t('business.routines.when',{days,time:schedule.time,zone:schedule.timeZone});
}
