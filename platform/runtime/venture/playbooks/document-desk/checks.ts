// Chausar playbook: the document desk (wave 6, 6E4). The document-figures check: a draft writes no amounts of its
// own; every figure a document shows comes from the desk's figures table and its code receipt. Written for Chausar.
import type {KitBaselineCase,KitCheckResult} from '../kit/define.ts';
import type {Deliverable} from '../../contracts.ts';
import {moneyAmounts} from '../kit/documents/money.ts';
import {computeFigures,unreceiptedAmounts} from './core.ts';

export function documentText(deliverable:Pick<Deliverable,'title'|'sections'>):string{
 return [deliverable.title,...deliverable.sections.flatMap(section=>[section.heading,...section.parts.flatMap(part=>part.kind==='text'?[part.text]:[])])].join('\n');
}
export function documentChecks(input:{deliverable:Pick<Deliverable,'title'|'sections'>}):KitCheckResult[]{
 const amounts=moneyAmounts(documentText(input.deliverable)).map(amount=>amount.text);
 return [{playbook:'document-desk',check:'document-figures',outcome:amounts.length?'fail':'pass',detail:amounts.length?`Write no amounts in the draft; the figures table carries them with a receipt. Found: ${amounts.slice(0,5).join(', ')}.`:'The draft leaves every amount to the figures table.'}];
}
export function scoreDocumentBaseline(item:KitBaselineCase,draft:string,meta:Readonly<Record<string,string>>){
 try{const figures=computeFigures(JSON.parse(meta.figures??'null'));const loose=unreceiptedAmounts(meta.text??'',figures);return {pass:(loose.length?'unreceipted':'receipted')===draft,why:'Code compares every amount with the figures receipt.'};}
 catch{return {pass:false,why:'The supplied figures are invalid.'};}
}
