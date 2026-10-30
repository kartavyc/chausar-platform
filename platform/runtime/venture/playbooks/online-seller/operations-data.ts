import {sellerOwnerOptions} from './owner-analysis.ts';
// Chausar seller reports, movement ledger and cases, original MIT/Apache commerce ideas.
import {check,type Context} from '../../../contracts.ts';import type {VentureDeps} from '../../contracts.ts';import {exactPayload,digest,findRecord,listRecords,ventureAction} from '../../records.ts';import {filesAddHandler} from '../../delivery/harness/files.ts';import {writeXlsx} from '../kit/ooxml/xlsx.ts';
import {sellerOrder} from './operations-store.ts';import {sellerFile,sellerCsv} from './source.ts';import {sellerCall} from './economics.ts';import {analyseSellerOperation,type SellerOperationMode} from './operations-analysis.ts';import {sellerOperationReceipt} from './operations-receipt.ts';import {sellerStock,type SellerMovement} from './stock.ts';import {sellerCase} from './cases.ts';
const out=(id:string,result:unknown,line:string)=>({playbook:'online-seller' as const,kind:'operations',id,result,line});
export async function sellerDataAction(deps:VentureDeps,ctx:Context,p:{action:string;id:string;payload:unknown}):Promise<ReturnType<typeof out>|null>{
 if(!['analyse','movement','case'].includes(p.action))return null;
 if(p.action==='analyse'){
  const body=exactPayload(p.payload,['orderId','mode','name','contentBase64','options'],['orderId','mode','name','contentBase64','options']);check(p.id===body.orderId,'SELLER_INPUT_INVALID','Choose the source order.');const {order}=sellerOrder(deps,ctx,String(body.orderId));const file=sellerCall(()=>sellerFile({name:body.name,contentBase64:body.contentBase64}));const data=sellerCall(()=>analyseSellerOperation(body.mode as SellerOperationMode,sellerCsv(file.text),sellerOwnerOptions(body.mode as SellerOperationMode,body.options),deps.clock().toISOString().slice(0,10)));
  const upload=await filesAddHandler(deps,ctx,{orderId:order.id,name:file.name,contentBase64:file.contentBase64});const receipt=await ventureAction(deps,ctx,'prepare','seller.analyse',tx=>{check(tx.find('venture-order',order.id)?.status==='open','ORDER_NOT_FOUND','Choose an open seller order.');const base=tx.base('venture-work-receipt');return tx.put({...base,...sellerOperationReceipt(data,{kind:'delivery',runId:base.id},{id:upload.id,name:upload.name,digest:upload.digest})});});
  const workbook=body.mode==='catalogue'?{name:'seller-'+(data as {channel:string}).channel+'.xlsx',contentBase64:Buffer.from(writeXlsx({sheets:[{name:'Catalogue',rows:(data as {rows:string[][]}).rows}]})).toString('base64')}:null;
  return out(order.id,{data,receiptId:receipt.id,figures:receipt.figures.map(figure=>({...figure,receiptId:receipt.id})),receipt:{inputs:receipt.inputs,steps:receipt.steps,explanation:receipt.explanation},file:workbook},'Computed from your source. Nothing sent or applied.');
 }
 const body=exactPayload(p.payload,p.action==='movement'?['orderId','movement']:['orderId','data']);check(p.id===body.orderId,'SELLER_INPUT_INVALID','Choose the source order.');const {order}=sellerOrder(deps,ctx,String(body.orderId));
 return ventureAction(deps,ctx,'approve','seller.'+p.action,tx=>{
  check(tx.find('venture-order',order.id)?.status==='open','ORDER_NOT_FOUND','Choose an open seller order.');
  if(p.action==='movement'){
   const existing=tx.list('venture-seller-movement').filter(record=>record.clientId===order.clientId).map(record=>record.movement);const movement=body.movement as SellerMovement;const counters=sellerCall(()=>sellerStock([...existing,movement]));const item=tx.put({...tx.base('venture-seller-movement'),orderId:order.id,clientId:order.clientId,movement:structuredClone(movement)});const receipt=tx.put({...tx.base('venture-work-receipt'),...sellerOperationReceipt(counters,{kind:'delivery',runId:item.id},{id:item.id,name:movement.source,digest:digest(movement)})});return out(item.id,{movement:item,counters,receiptId:receipt.id,figures:receipt.figures.map(figure=>({...figure,receiptId:receipt.id})),receipt:{inputs:receipt.inputs,steps:receipt.steps,explanation:receipt.explanation}},'Movement recorded. No marketplace stock was changed.');
  }
  const data=sellerCall(()=>sellerCase(body.data));for(const id of data.attachments){const file=tx.find('venture-upload',id);check(file?.ventureId===tx.venture!.id&&(file.scope.kind==='order'||file.scope.kind==='media')&&file.scope.orderId===order.id,'UPLOAD_NOT_FOUND','Attach only evidence files from this order.');}
  const item=tx.put({...tx.base('venture-seller-case'),orderId:order.id,clientId:order.clientId,data});return out(item.id,item,'Case saved. Closed does not mean solved. Nothing submitted.');
 });
}
