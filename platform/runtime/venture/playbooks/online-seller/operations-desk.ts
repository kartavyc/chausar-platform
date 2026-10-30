import {sellerPhotoAction} from './photos-desk.ts';
import {sellerOwnerCaps,sellerOwnerChange,sellerStageNumbers} from './owner-form.ts';
import {sellerOperationReceipt} from './operations-receipt.ts';
import {sellerOrder as orderOf} from './operations-store.ts';
import {sellerDataAction} from './operations-data.ts';
// Chausar seller operations owner API. Shopify staging Apache-2.0/MIT ideas; no marketplace write is claimed.
import {check,newId,type Context} from '../../../contracts.ts';
import type {VentureDeps,OrderRecord,SellerStageRecord} from '../../contracts.ts';
import {digest,exactPayload,findRecord,listRecords,readVenture,requireAppChannel,ventureAction} from '../../records.ts';
import {acceptedBlueprintOrNull} from '../../delivery/shared.ts';
import {filesAddHandler} from '../../delivery/harness/files.ts';
import type {DeskHandlers,DeskKindTypes} from '../desk-types.ts';
import {sellerFile,sellerCsv} from './source.ts';
import {sellerCall} from './economics.ts';
import {sellerProduct,stageSellerChange,checkSellerApply,sellerChangeHandoff,type SellerCaps} from './staging.ts';
export type SellerOperationsDeskTypes={operations:DeskKindTypes};
type Read={id:string;orderId:string;sourceId:string;sourceDigest:string;caps:SellerCaps;memberId:string;epoch:number};
const sessions=new WeakMap<object,Map<string,Read>>();
const session=(deps:VentureDeps)=>{let map=sessions.get(deps.store);if(!map){map=new Map();sessions.set(deps.store,map);}return map;};

function readProducts(text:string){return sellerCsv(text).map(row=>sellerProduct({...row,breakEvenMinor:row.breakEvenMinor||null}));}
function fileRead(deps:VentureDeps,ctx:Context,read:Read){const {state,venture,order}=orderOf(deps,ctx,read.orderId);check(read.memberId===ctx.memberId&&read.epoch===ctx.epoch,'SELLER_PROVENANCE_REQUIRED','Read this product in your current session.');const file=findRecord(state,'venture-upload',read.sourceId);check(file?.ventureId===venture.id&&file.digest===read.sourceDigest&&(file.scope.kind==='order'||file.scope.kind==='media')&&file.scope.orderId===order.id,'SELLER_SOURCE_CHANGED','The source file changed or was removed.');return {order,file,products:sellerCall(()=>readProducts(Buffer.from(file.contentBase64,'base64').toString('utf8')))};}
const view=(item:SellerStageRecord)=>({...item,digest:digest(item),secondAsk:item.stageKind==='change'?item.proposal.money:true,marketplaceApplied:false});
const out=(id:string,result:unknown,line:string)=>({playbook:'online-seller' as const,kind:'operations',id,result,line});
/** No outside effect: the owner prepares an exact reviewed file and uploads it themselves. */
export const SELLER_OPERATIONS_DESK:DeskHandlers={operations:{
 async list(deps,ctx,p){exactPayload(p,['playbook','kind','filter'],['playbook','kind']);const f=exactPayload(p.filter??{},['orderId','view']);const {state,venture}=readVenture(deps,ctx);check(f.view===undefined||['stages','cases','movements'].includes(String(f.view)),'SELLER_INPUT_INVALID','Choose a seller record view.');if(f.view==='cases'||f.view==='movements')return {playbook:'online-seller',kind:'operations',rows:listRecords(state,f.view==='cases'?'venture-seller-case':'venture-seller-movement',venture.id).filter(item=>f.orderId===undefined||item.orderId===f.orderId).slice().reverse(),line:'Owner records. Nothing submitted.'};return {playbook:'online-seller',kind:'operations',rows:listRecords(state,'venture-seller-stage',venture.id).filter(item=>f.orderId===undefined||item.orderId===f.orderId).map(view).reverse(),line:'Staged seller changes. Nothing is applied to a marketplace here.'};},
 async get(deps,ctx,p){exactPayload(p,['playbook','kind','id'],['playbook','kind','id']);const {state,venture}=readVenture(deps,ctx);const item=findRecord(state,'venture-seller-stage',String(p.id));check(item?.ventureId===venture.id,'SELLER_STAGE_NOT_FOUND','This staged change was not found.');return {playbook:'online-seller',kind:'operations',item:view(item),digest:digest(item)};},
 async act(deps,ctx,p){
  requireAppChannel(ctx,'venture.desk.act');check(ctx.role==='owner','OWNER_REQUIRED','Only the owner can approve a seller operation.');exactPayload(p,['playbook','kind','id','action','payload','digest'],['playbook','kind','id','action','payload']);
  if(p.action==='read'){
   const body=exactPayload(p.payload,['orderId','name','contentBase64','caps'],['orderId','name','contentBase64','caps']);check(p.id===body.orderId,'SELLER_INPUT_INVALID','Read the selected order.');const {order}=orderOf(deps,ctx,String(body.orderId));const file=sellerCall(()=>sellerFile({name:body.name,contentBase64:body.contentBase64}));const products=sellerCall(()=>readProducts(file.text));check(products.length>0&&new Set(products.map(product=>product.channel+':'+product.sku)).size===products.length,'SELLER_INPUT_INVALID','Use distinct channel and SKU rows.');
   // Validates owner caps without inventing a price move.
   const caps=sellerCall(()=>sellerOwnerCaps(body.caps));sellerCall(()=>stageSellerChange(products[0],{field:'title',value:products[0].title},caps,deps.clock().toISOString().slice(0,10)));
   const upload=await filesAddHandler(deps,ctx,{orderId:order.id,name:file.name,contentBase64:file.contentBase64});const read:Read={id:newId('sellerread'),orderId:order.id,sourceId:upload.id,sourceDigest:upload.digest,caps,memberId:ctx.memberId,epoch:ctx.epoch};session(deps).set(read.id,read);session(deps).set('order:'+order.id,read);
   return out(order.id,{readId:read.id,products,sourceId:upload.id,caps:read.caps},'Read from your export in this session.');
  }
  if(p.action==='stage'){
   const body=exactPayload(p.payload,['readId','sku','channel','change'],['readId','sku','channel','change']);const read=session(deps).get(String(body.readId));check(read&&read.orderId===p.id,'SELLER_PROVENANCE_REQUIRED','Read the product in this session before staging it.');const {order,file,products}=fileRead(deps,ctx,read);const matches=products.filter(product=>product.sku===body.sku&&product.channel===body.channel);check(matches.length===1,'SELLER_PROVENANCE_REQUIRED','Choose one exact SKU from the read export.');const proposal=sellerCall(()=>stageSellerChange(matches[0],sellerOwnerChange(body.change,matches[0].currency),read.caps,deps.clock().toISOString().slice(0,10)));
   const item=await ventureAction(deps,ctx,'approve','seller.stage',tx=>{const current=tx.find('venture-order',order.id);check(current?.status==='open','ORDER_NOT_FOUND','Choose an open seller order.');const base=tx.base('venture-seller-stage');const receipt=tx.put({...tx.base('venture-work-receipt'),...sellerOperationReceipt(sellerStageNumbers(proposal),{kind:'delivery',runId:base.id},{id:file.id,name:file.name,digest:file.digest})});return tx.put({...base,receiptId:receipt.id,figures:receipt.figures.map(figure=>({...figure,receiptId:receipt.id})),receipt:{inputs:receipt.inputs,steps:receipt.steps,explanation:receipt.explanation},orderId:order.id,clientId:order.clientId,sourceId:file.id,sourceDigest:file.digest,readId:read.id,stageKind:'change',proposal,status:'staged',approvedBy:null,approvedAt:null,handoff:null});});return out(item.id,view(item),'Dry run. Review the exact change before preparing a handoff.');
  }
  const photo=await sellerPhotoAction(deps,ctx,p);if(photo)return photo;
  const computed=await sellerDataAction(deps,ctx,p);if(computed)return computed;
  check(['confirm','handoff'].includes(p.action),'SELLER_ACTION_INVALID','Choose a seller operation.');const body=exactPayload(p.payload,p.action==='confirm'?['name']:[],p.action==='confirm'?['name']:[]);
  const item=await ventureAction(deps,ctx,'approve','seller.'+p.action,tx=>{
   const record=tx.find('venture-seller-stage',String(p.id));check(record?.ventureId===tx.venture!.id,'SELLER_STAGE_NOT_FOUND','This staged change was not found.');check(record.stageKind==='change','SELLER_ACTION_INVALID','Choose a listing change.');check(p.digest===digest(record)&&record.status!=='handoff','SELLER_STAGE_STALE','The staged change moved on. Open it again.');const own=tx.find('venture-order',record.orderId);check(own?.status==='open','ORDER_NOT_FOUND','Choose an open seller order.');
   const original=session(deps).get(record.readId),latest=session(deps).get('order:'+record.orderId);check(original&&latest,'SELLER_PROVENANCE_REQUIRED','The session ended. Read and stage the change again.');const current=fileRead(deps,ctx,latest).products.find(product=>product.sku===record.proposal.product.sku&&product.channel===record.proposal.product.channel);check(current,'SELLER_PROVENANCE_REQUIRED','The current export no longer contains this product.');sellerCall(()=>checkSellerApply(record.proposal,current,latest.caps,tx.now.slice(0,10)));
   if(p.action==='confirm'){check(record.status==='staged','SELLER_STAGE_STALE','The staged change moved on.');check(record.proposal.confirmName===null?body.name===null:body.name===record.proposal.confirmName,'SELLER_CONFIRM_NAME_REQUIRED','Type the exact destructive action name.');return tx.replace({...record,status:'confirmed',approvedBy:ctx.memberId,approvedAt:tx.now});}
   check(record.status==='confirmed'&&record.approvedBy===ctx.memberId,'SELLER_APPROVAL_REQUIRED','Approve the exact change before its handoff.');const handoff=sellerChangeHandoff(record.proposal);return tx.replace({...record,status:'handoff',handoff});
  });const result=view(item);return out(item.id,{...result,...(item.handoff?{file:item.handoff}:{})},item.status==='handoff'?'Handoff ready. You upload it. No marketplace change was made.':'Exact change approved. Review again before preparing the money handoff.');
 }
}};
