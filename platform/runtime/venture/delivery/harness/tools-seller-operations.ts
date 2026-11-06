// Real source-only seller operation tools. No external writes or provider calls.
import {check} from '../../../contracts.ts';
import {fileOf,text,receiptOut,type Spec,type ToolEnv} from './tools.ts';
import {tablesOfFile} from './files.ts';
import {analyseSellerOperation,type SellerOperationMode} from '../../playbooks/online-seller/operations-analysis.ts';
import {sellerSourceOptions} from '../../playbooks/online-seller/operations-input.ts';
import {sellerOperationReceipt} from '../../playbooks/online-seller/operations-receipt.ts';
import {sellerCall} from '../../playbooks/online-seller/economics.ts';
import {sellerProduct,stageSellerChange} from '../../playbooks/online-seller/staging.ts';
import {writeXlsx} from '../../playbooks/kit/ooxml/xlsx.ts';
import type {Json,ToolName} from '../../contracts.ts';
const rows=(file:ToolEnv['files'][number])=>{check(file.format==='csv','SELLER_INPUT_INVALID','Use the source CSV export.');return tablesOfFile(file)[0]?.rows.map(row=>row.cells)??[];};
export function sellerOperationTool(name:ToolName,mode:SellerOperationMode,summary:string):Spec{return {name,effect:'compute',tier:'code',endsTurn:false,summary,input:{file:text('The original owner export file.',12)},async run(env,input){
 const file=fileOf(env,input.file);const settings=(env.intake?.fields??{}) as Record<string,unknown>;
 const options=sellerCall(()=>sellerSourceOptions(mode,settings,id=>{const source=env.files.find(item=>item.id===id);check(source,'UPLOAD_NOT_FOUND','The owner settings file is missing from this order.');return rows(source);}));
 const data=sellerCall(()=>analyseSellerOperation(mode,rows(file),options,env.now().slice(0,10)));const receipt=receiptOut(env,sellerOperationReceipt(data,env.runRef,{id:file.id,name:file.name,digest:file.digest}));
 const workbook=mode==='catalogue'?{name:'seller-'+(data as {channel:string}).channel+'.xlsx',contentBase64:Buffer.from(writeXlsx({sheets:[{name:'Catalogue',rows:(data as {rows:string[][]}).rows}]})).toString('base64')}:null;
 return {result:{data,receipt:receipt.alias,figures:receipt.figures,file:workbook} as Json,receipts:[receipt.record]};
}};}
/** Draft-only preview from owner files. Actual approval and handoff only exist on the owner desk. */
export const SELLER_STAGE_TOOL:Spec={name:'seller.stage',effect:'compute',tier:'code',endsTurn:false,summary:'Previews exact source-bound changes. The owner desk must read, stage and approve each handoff.',input:{file:text('The product export already read in this run.',12),changes:text('Owner change CSV with sku, field, value, priceChangeBps, promotionBps, scope, depthBps and endsOn.',12)},async run(env,input){
 const file=fileOf(env,input.file),changes=fileOf(env,input.changes);check(env.calls?.some(call=>call.tool==='files.read'&&call.envelope.ok&&(call.input as {file?:string;table?:string}|null)?.file===input.file),'SELLER_PROVENANCE_REQUIRED','Read the product export in this run before previewing a change.');
 const products=sellerCall(()=>rows(file).map(row=>sellerProduct({...row,breakEvenMinor:row.breakEvenMinor||null})));
 const previews=sellerCall(()=>rows(changes).map(row=>{check(Object.keys(row).every(key=>['sku','field','value','priceChangeBps','promotionBps','scope','depthBps','endsOn'].includes(key)),'SELLER_INPUT_INVALID','Only named owner change columns are accepted.');const matches=products.filter(product=>product.sku===row.sku);check(matches.length===1,'SELLER_PROVENANCE_REQUIRED','Choose a distinct SKU read in this run.');return stageSellerChange(matches[0],{field:row.field,value:row.value,...(row.scope?{scope:row.scope}:{}),...(row.depthBps?{depthBps:row.depthBps}:{}),...(row.endsOn?{endsOn:row.endsOn}:{})},{priceChangeBps:row.priceChangeBps,promotionBps:row.promotionBps},env.now().slice(0,10));}));
 const receipt=receiptOut(env,sellerOperationReceipt(previews,env.runRef,{id:file.id,name:file.name,digest:file.digest}));return {result:{previews,receipt:receipt.alias,figures:receipt.figures,approved:false,line:'Dry previews only. Open the owner desk to stage and approve each exact handoff.'} as Json,receipts:[receipt.record]};
}};
