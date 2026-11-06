// Chausar seller owner workflows. Shopify staging Apache/MIT ideas, independently implemented.
import {useId,useState,type ReactNode} from 'react';
import {useEngine} from '../../../engine/context';
import {EngineError} from '../../../engine/types';
export type SellerJson=string|number|boolean|null|SellerJson[]|{[key:string]:SellerJson};
import {useT} from '../../../text';
import {Tile,TileHead} from '../../../parts/Tile';
import {Field} from '../../../parts/Field';
import {Button} from '../../../parts/Button';
import {Figure} from '../../../parts/Figure';
import {Sheet} from '../../../parts/Sheet';
import type {SellerStageBody} from '../../../../../../platform/runtime/venture/playbooks/online-seller/records';
import type {SellerProduct} from '../../../../../../platform/runtime/venture/playbooks/online-seller/staging';
import s from './OnlineSellerDesk.module.css';
import {SellerReports} from './SellerReports';
import {SellerRecords} from './SellerRecords';
import {SellerPhotos} from './SellerPhotos';

export type SellerStage=SellerStageBody&{id:string;digest:string;marketplaceApplied:false};
export type SellerAct=(action:string,payload:SellerJson,id?:string,digest?:string)=>Promise<unknown>;
export function sellerUpload(file:File):Promise<{name:string;contentBase64:string}> {return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({name:file.name,contentBase64:String(reader.result).split(',')[1]??''});reader.onerror=()=>reject(new Error('FILE_UNREADABLE'));reader.readAsDataURL(file);});}
export function sellerDownload(name:string,text:string,base64=false){const bytes=base64?Uint8Array.from(atob(text),c=>c.charCodeAt(0)):text;const url=URL.createObjectURL(new Blob([bytes]));const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
export function SellerSelect({label,value,onChange,children}:{label:string;value:string;onChange:(value:string)=>void;children:ReactNode}) {const id=useId();return <><label htmlFor={id}>{label}</label><select id={id} className={s.select} value={value} onChange={event=>onChange(event.currentTarget.value)}>{children}</select></>;}
export function SellerFigures({result}:{result:{figures:{key:string;display:string;receiptId:string}[];receipt:{inputs:unknown;steps:unknown;explanation:string}}}) {
 const t=useT(),[receipt,setReceipt]=useState(false);
 const label=(key:string)=>t('pb-seller-ops.figure.'+key.split('.').at(-1));
 return <><dl className={s.figures}>{result.figures.map(f=><div key={f.key}><dt>{label(f.key)}</dt><dd><Figure value={f.display} receiptId={f.receiptId} onReceipt={()=>setReceipt(true)}/></dd></div>)}</dl>{receipt&&<Sheet receipt label={t('pb-online-seller.receipt')} title={t('pb-online-seller.receipt')} onClose={()=>setReceipt(false)}><div className={s.body}><p>{t('pb-seller-ops.sourceReceipt')}</p>{((result.receipt.inputs as {tables?:{name?:string}[]}).tables??[]).map((source,i)=><p key={i} data-content="">{source.name}</p>)}<dl className={s.figures}>{result.figures.map(f=><div key={f.key}><dt>{label(f.key)}</dt><dd>{f.display}</dd></div>)}</dl></div></Sheet>}</>;
}
/** Exact owner review is separate from a second money handoff approval. */
function SellerChange({act,busy}:{act:SellerAct;busy:boolean}) {
 const t=useT();const [file,setFile]=useState<File|null>(null),[priceCap,setPriceCap]=useState(''),[promotionCap,setPromotionCap]=useState(''),[read,setRead]=useState<{readId:string;products:SellerProduct[]}|null>(null),[sku,setSku]=useState(''),[field,setField]=useState('price'),[value,setValue]=useState(''),[clearance,setClearance]=useState(false),[scope,setScope]=useState(''),[depth,setDepth]=useState(''),[ends,setEnds]=useState(''),[name,setName]=useState(''),[stage,setStage]=useState<SellerStage|null>(null);
 async function readSource(){if(!file)return;const result=await act('read',{...await sellerUpload(file),caps:{priceChangePercent:priceCap,promotionPercent:promotionCap}}) as typeof read;if(result){setRead(result);setSku(result.products[0]?JSON.stringify([result.products[0].channel,result.products[0].sku]):'');setStage(null);}}
 async function preview(){if(!read)return;const change:SellerJson=field==='price'?{field,rupees:value,clearance}:field==='promotion'?{field,value,scope,depthPercent:depth,endsOn:ends,clearance}:{field,value:field==='archive'?'yes':value};const result=await act('stage',{readId:read.readId,channel:JSON.parse(sku)[0],sku:JSON.parse(sku)[1],change}) as SellerStage|null;if(result){setStage(result);setName('');}}
 async function approve(action:string){if(!stage)return;const result=await act(action,action==='confirm'?{name:stage.stageKind==='change'&&stage.proposal.confirmName?name:null}:{},stage.id,stage.digest) as SellerStage|null;if(result)setStage(result);}
 return <div className={s.body}>
  <Field type="file" accept=".csv,text/csv" label={t('pb-seller-ops.products')} onChange={e=>{setFile(e.currentTarget.files?.[0]??null);setRead(null);setStage(null);}}/>
  <Field label={t('pb-seller-ops.priceCap')} inputMode="decimal" value={priceCap} onChange={e=>{setPriceCap(e.currentTarget.value);setRead(null);setStage(null);}}/><Field label={t('pb-seller-ops.promotionCap')} inputMode="decimal" value={promotionCap} onChange={e=>{setPromotionCap(e.currentTarget.value);setRead(null);setStage(null);}}/>
  <Button variant="quiet" disabled={busy} locked={!file||!priceCap||!promotionCap} lockedReason={t('pb-seller-ops.sourceFirst')} onClick={()=>void readSource()}>{t('pb-seller-ops.read')}</Button>
  {read&&<><SellerSelect label={t('pb-seller-ops.product')} value={sku} onChange={v=>{setSku(v);setStage(null);}}>{read.products.map(product=><option key={product.channel+product.sku} value={JSON.stringify([product.channel,product.sku])}>{product.channel+' / '+product.sku+': '+product.title}</option>)}</SellerSelect>
   <SellerSelect label={t('pb-seller-ops.field')} value={field} onChange={v=>{setField(v);setStage(null);setValue('');}}>{['price','stock','title','promotion','archive'].map(v=><option key={v} value={v}>{t('pb-seller-ops.field.'+v)}</option>)}</SellerSelect>
   {field!=='archive'&&<Field label={t(field==='price'?'pb-seller-ops.rupees':'pb-seller-ops.newValue')} value={value} onChange={e=>{setValue(e.currentTarget.value);setStage(null);}}/>}
   {(field==='price'||field==='promotion')&&<Field type="checkbox" label={t('pb-seller-ops.clearance')} checked={clearance} onChange={e=>{setClearance(e.currentTarget.checked);setStage(null);}}/>}
   {field==='promotion'&&<><Field label={t('pb-seller-ops.scope')} value={scope} onChange={e=>{setScope(e.currentTarget.value);setStage(null);}}/><Field label={t('pb-seller-ops.depth')} value={depth} onChange={e=>{setDepth(e.currentTarget.value);setStage(null);}}/><Field type="date" label={t('pb-seller-ops.ends')} value={ends} onChange={e=>{setEnds(e.currentTarget.value);setStage(null);}}/></>}
   <Button variant="quiet" disabled={busy} onClick={()=>void preview()}>{t('pb-seller-ops.preview')}</Button>
  </>}
  {stage?.stageKind==='change'&&<div className={s.body}><h3 className={s.heading}>{t('pb-seller-ops.exact')}</h3><p data-content="">{stage.proposal.product.sku}: {stage.proposal.product.title}</p><p>{t('pb-seller-ops.field.'+stage.proposal.change.field)}</p>{stage.proposal.change.field!=='price'&&<p data-content="">{stage.proposal.change.value}</p>}{stage.proposal.change.field==='promotion'&&<><p data-content="">{stage.proposal.change.scope}</p><p>{t('pb-seller-ops.ends')}: <span data-content="">{stage.proposal.change.endsOn}</span></p></>}<SellerFigures result={stage}/>
   <p>{t(stage.proposal.descriptionComplete?'pb-seller-ops.complete':'pb-seller-ops.incomplete')}</p>{stage.proposal.clearance&&<p>{t('pb-seller-ops.clearance')}</p>}
   {stage.proposal.confirmName&&<Field label={t('pb-seller-ops.confirmName')} hint={stage.proposal.confirmName} value={name} onChange={e=>setName(e.currentTarget.value)}/>}
   {stage.status==='staged'&&<Button variant="primary" disabled={busy} locked={!stage.proposal.descriptionComplete||!!stage.proposal.confirmName&&name!==stage.proposal.confirmName} lockedReason={t('pb-seller-ops.reviewFirst')} onClick={()=>void approve('confirm')}>{t('pb-seller-ops.approve')}</Button>}
   {stage.status==='confirmed'&&<Button variant="primary" disabled={busy} onClick={()=>void approve('handoff')}>{t('pb-seller-ops.handoff')}</Button>}
   {stage.handoff&&<><Button variant="quiet" onClick={()=>sellerDownload(stage.handoff!.name,stage.handoff!.text)}>{t('pb-seller-ops.download')}</Button></>}
  </div>}
 </div>;
}
/** Operations are one step away from ordinary audits; switching order clears pending form state. */
export function SellerOperations({orderId}:{orderId:string}) {
 const t=useT(),engine=useEngine(),[busy,setBusy]=useState(false),[problem,setProblem]=useState<string|null>(null),[task,setTask]=useState('change');
 const act:SellerAct=async(action,payload,id=orderId,digest)=>{if(busy)return null;setBusy(true);setProblem(null);try{const body=['read','analyse','movement','case','photo-quote'].includes(action)?{...(payload as Record<string,SellerJson>),orderId}:payload;return (await engine.request('venture.desk.act',{playbook:'online-seller',kind:'operations',id,action,payload:body,...(digest?{digest}:{})})).result;}catch(error){const code=error instanceof EngineError?error.code:'generic';const key='pb-seller-ops.error.'+code;const words=t(key);setProblem(words===key?t('pb-seller-ops.error.generic'):words);return null;}finally{setBusy(false);}};
 return <Tile as="section" label={t('pb-seller-ops.title')}><TileHead title={t('pb-seller-ops.title')}/><div className={s.body}><p className={s.line}>{t('pb-seller-ops.manual')}</p><SellerSelect label={t('pb-seller-ops.task')} value={task} onChange={v=>{setTask(v);setProblem(null);}}>{['change','reports','records','photos'].map(v=><option key={v} value={v}>{t('pb-seller-ops.task.'+v)}</option>)}</SellerSelect>{task==='change'?<SellerChange key={orderId} act={act} busy={busy}/>:task==='reports'?<SellerReports key={orderId} act={act} busy={busy}/>:task==='records'?<SellerRecords key={orderId} orderId={orderId} act={act} busy={busy}/>:<SellerPhotos key={orderId} orderId={orderId} act={act} busy={busy}/ >}{problem&&<p role="alert">{problem}</p>}</div></Tile>;
}
