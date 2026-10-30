// CA12 original vault-backed records and explicit XLSX handoff, using Chausar's encrypted state and ECMA-376 writer.
import {check,ChausarError,type Context} from '../../../contracts.ts';
import type {VentureDeps,CaDataPackRecord} from '../../contracts.ts';
import {digest,exactPayload,readVenture,findRecord,listRecords,requireAppChannel,ventureAction} from '../../records.ts';
import type {DeskHandlers} from '../desk-types.ts';
import {writeXlsx,type XlsxCell} from '../kit/ooxml/xlsx.ts';
import {packReceipt,packFacts,packSelection,maskedPack,packRows,PackError,type PackSelection} from './pack-core.ts';
import {ownerPack} from './owner-input.ts';
import {caWorkReceipt} from '../../delivery/harness/tools-ca.ts';
import {newLog} from './tool-inputs.ts';
import type {ToolEnv} from '../../delivery/harness/tools.ts';
export function packCall<T>(fn:()=>T):T{try{return fn();}catch(error){if(error instanceof PackError)throw new ChausarError(error.code,error.message);throw error;}}
const packDigest=(row:CaDataPackRecord)=>digest({id:row.id,clientId:row.clientId,facts:row.facts});
const view=(row:CaDataPackRecord)=>({id:row.id,digest:packDigest(row),...maskedPack(row.facts),receiptId:row.receiptId,figures:packReceipt({figures:maskedPack(row.facts).figures}).figures});
const out=(id:string,result:unknown)=>({playbook:'ca-firm' as const,kind:'data-pack',id,result,line:'Return preparation only. Nothing filed or sent.'});
function selected(deps:VentureDeps,ctx:Context,p:PackSelection){const {state,venture}=readVenture(deps,ctx);const row=findRecord(state,'venture-ca-data-pack',p.packId);check(row?.ventureId===venture.id,'CA_PACK_NOT_FOUND','Choose a saved pack in this business.');check(packDigest(row)===p.digest,'CA_PACK_CHANGED','The return pack changed. Review it again.');const selection=packCall(()=>packSelection(p,row.facts));return {row,selection,approvalDigest:digest(selection)};}
export const DATA_PACK_DESK:DeskHandlers={'data-pack':{
 async list(deps,ctx,p){exactPayload(p,['playbook','kind','filter'],['playbook','kind']);const f=exactPayload(p.filter??{},['clientId']);const {state,venture}=readVenture(deps,ctx);return {playbook:'ca-firm',kind:'data-pack',rows:listRecords(state,'venture-ca-data-pack',venture.id).filter(row=>!f.clientId||row.clientId===f.clientId).map(view),line:'Saved return packs. Identifiers are masked.'};},
 async get(deps,ctx,p){exactPayload(p,['playbook','kind','id'],['playbook','kind','id']);const {state,venture}=readVenture(deps,ctx);const row=findRecord(state,'venture-ca-data-pack',p.id);check(row?.ventureId===venture.id,'CA_PACK_NOT_FOUND','Choose a saved pack.');return {playbook:'ca-firm',kind:'data-pack',item:view(row),digest:packDigest(row)};},
 async act(deps,ctx,p){requireAppChannel(ctx,'venture.desk.act');check(ctx.role==='owner','OWNER_REQUIRED','Only the owner can prepare return packs.');exactPayload(p,['playbook','kind','id','action','payload','digest'],['playbook','kind','id','action','payload']);
  check(['save','preview-export'].includes(p.action),'CA_PACK_ACTION_INVALID','Choose a return pack action.');
  if(p.action==='preview-export'){const {state,venture}=readVenture(deps,ctx);const row=findRecord(state,'venture-ca-data-pack',p.id);check(row?.ventureId===venture.id,'CA_PACK_NOT_FOUND','Choose a saved pack.');const selection=packCall(()=>packSelection(p.payload,row.facts));check(selection.packId===p.id&&selection.digest===p.digest,'CA_PACK_CHANGED','Review the selected saved pack.');const found=selected(deps,ctx,selection);return out(p.id,{...selection,approvalDigest:found.approvalDigest,preview:maskedPack(found.row.facts)});}
  const raw=p.payload as Record<string,unknown>;const facts=packCall(()=>raw.csv!==undefined?ownerPack(raw):packFacts(raw));const row=await ventureAction(deps,ctx,'approve','ca.pack.save',tx=>{const client=tx.find('venture-client',facts.clientId);check(client,'CLIENT_NOT_FOUND','Choose a current client.');const old=p.id==='new'?null:tx.find('venture-ca-data-pack',p.id);if(p.id!=='new')check(old&&old.clientId===facts.clientId&&packDigest(old)===p.digest,'CA_PACK_CHANGED','The return pack changed. Read it again.');const base=old??tx.base('venture-ca-data-pack');const inputs={figures:maskedPack(facts).figures};const env={deps,ventureId:tx.venture!.id,memberId:ctx.memberId,epoch:ctx.epoch,currency:'INR',dateOrder:'day-month-year',runRef:{kind:'delivery',runId:base.id},files:[],tables:[],receipts:[],dictionary:[],allowed:[],sandbox:undefined,now:()=>tx.now} as ToolEnv;const receipt=caWorkReceipt(env,packReceipt(inputs),inputs,newLog()).record;tx.put(receipt);const saved={...base,clientId:facts.clientId,facts,receiptId:receipt.id,exportApprovals:[]};return old?tx.replace(saved as CaDataPackRecord):tx.put<CaDataPackRecord>(saved);});return out(row.id,view(row));
 }
}};
/** App-only exact approval yields XLSX bytes, never writes an identity JSON file or sends to a recipient. */
export async function caDataPackExport(deps:VentureDeps,ctx:Context,payload:unknown){
 requireAppChannel(ctx,'venture.ca.dataPack.export');check(ctx.role==='owner','OWNER_REQUIRED','Only the owner can approve a return export.');const p=exactPayload(payload,['packId','digest','fields','unmask','requestedBy','purpose','approvalDigest'],['packId','digest','fields','unmask','requestedBy','purpose','approvalDigest']);const {approvalDigest,...raw}=p;const found=selected(deps,ctx,raw as PackSelection);check(approvalDigest===found.approvalDigest,'CA_PACK_APPROVAL_REQUIRED','Approve the exact fields and disclosures you reviewed.');
 const rows=packRows(found.row.facts,found.selection);
 const bytes=writeXlsx({sheets:[{name:'Return data',rows}]});
 await ventureAction(deps,ctx,'approve','venture.ca.dataPack.export',tx=>{const current=tx.find('venture-ca-data-pack',found.row.id);check(current&&packDigest(current)===found.selection.digest,'CA_PACK_CHANGED','The return pack changed. Review it again.');/* Approval journal stores only a digest, never raw identifiers. */tx.replace({...current,exportApprovals:[...current.exportApprovals,found.approvalDigest].slice(-100)});});
 return {name:'return-data-pack.xlsx',mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',contentBase64:Buffer.from(bytes).toString('base64'),digest:digest(Buffer.from(bytes).toString('base64')),approvalDigest:found.approvalDigest};
}
