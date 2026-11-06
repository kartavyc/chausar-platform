// Chausar playbook: the document desk (wave 6, 6E4). Its dated house rules. Written for Chausar.
import type {DatedRule} from '../kit/rule-type.ts';
const house=(id:string,topic:string,rule:string,how:string,usedBy:string[],limitations:string):DatedRule=>({id,scope:'house',topic,rule,sources:[],checkedOn:'2026-11-01',read:'house',how,usedBy,limitations,needs:null});
export const DOCUMENT_DESK_RULES:readonly DatedRule[]=Object.freeze([
 house('figures-from-receipt','Figures in documents','Every amount a document shows comes from the figures table and its code receipt.','Code refuses section text with an amount the receipt does not prove.',['figures','review','document-figures'],'A receipt proves the arithmetic, not the rates or quantities the owner entered.'),
 house('owner-sends-documents','Sending documents','The owner approves the exact document and sends it to the client.','Code binds the approval to a digest of the brief and every section.',['review','send'],'Chausar does not file or submit a document anywhere.'),
]);
