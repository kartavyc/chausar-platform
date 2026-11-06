// Chausar multi-currency seller receipts. Money and counts are computed here, never by the screen.
import {digest} from '../../records.ts';import {sellerOperationFigures} from './operations-figures.ts';
import type {WorkReceiptDraft} from '../../delivery/harness/work.ts';import type {WorkRunRef} from '../../contracts.ts';
export function sellerOperationReceipt(data:unknown,runRef:WorkRunRef,source:{id:string;name:string;digest:string}):WorkReceiptDraft{
 const figures=sellerOperationFigures(data);const base={operation:'seller.compute' as WorkReceiptDraft['operation'],runRef,currency:'INR',inputs:{tables:[source],columns:{source:source.name},rowIds:[]},steps:figures.map(figure=>({op:'compare' as const,inputs:[source.id],result:figure.minor,rule:'Source-backed seller operation with integer arithmetic and currencies kept separate.'})),figures,reconciliation:null,allowedNumbers:figures.flatMap(figure=>[figure.minor,figure.display]),explanation:'Computed from the named owner source. Unknown metrics remain unknown.'};return {...base,digest:digest(base)};
}
