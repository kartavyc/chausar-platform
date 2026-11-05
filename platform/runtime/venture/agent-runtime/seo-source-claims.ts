import {check, type State} from '../../contracts.ts';
import type {DeliveryRunRecord,UploadRecord,WorkReceiptRecord} from '../contracts.ts';
import {digest,findRecord,listRecords} from '../records.ts';
import {readSeoManifest} from '../playbooks/seo-visibility/manifest-core.ts';
import {corroborateClaims} from '../playbooks/seo-visibility/corroborate.ts';
import type {ClaimInput} from '../playbooks/seo-visibility/content-core.ts';
import type {PoliteNet} from '../build/fetch-policy.ts';
import type {JobCalculation} from './job-tools.ts';

export const SEO_SOURCE_CLAIM:JobCalculation={name:'seo_source_claim',description:'Verify one owner-recorded percentage against independent public sources. Arguments: fileId of this order’s seo-evidence.csv and claimId. Returns a receipt figure; quote its reference with the returned claim marker. Source agreement is not independent proof that the claim is true.',inputSchema:{type:'object',additionalProperties:false,properties:{fileId:{type:'string',minLength:1,maxLength:200},claimId:{type:'string',pattern:'^[a-z][a-z0-9-]{0,39}$'}},required:['fileId','claimId']}};
export function sourceClaimOffer(state:State,run:DeliveryRunRecord):boolean {
 const order=findRecord(state,'venture-order',run.orderId),price=order&&findRecord(state,'venture-price-receipt',order.priceReceiptId);
 const blueprint=price&&listRecords(state,'venture-blueprint',run.ventureId).find(row=>row.digest===price.inputs.blueprintDigest);
 const offer=blueprint?.offers.find(row=>row.id===order?.offerId);
 return !!offer&&['content-retainer','local-seo'].includes(offer.playbookOffer??'')&&(order?.chainStage??0)===0;
}
/** No model-supplied numbers, URLs, page bodies, identities or receipt ids enter this operation. */
export async function checkedSourceClaim(file:UploadRecord,claimId:string,runId:string,currency:string,net:PoliteNet):Promise<Omit<WorkReceiptRecord,'id'|'kind'|'ventureId'|'memberId'|'epoch'|'at'>> {
 check(file.name==='seo-evidence.csv'&&file.bytes<=1000000&&digest(file.contentBase64)===file.digest,'SEO_INPUT_INVALID','Choose this order’s current bounded seo-evidence.csv.');
 const data=readSeoManifest(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(file.contentBase64,'base64')));
 check(Array.isArray(data.claims)&&data.claims.length<=50&&Array.isArray(data.competitors),'SEO_INPUT_INVALID','Record the claim sources in the evidence list.');
 const matches=data.claims.filter((claim:ClaimInput)=>claim?.id===claimId);
 check(matches.length===1,'SEO_INPUT_INVALID','Choose one unique claim from this evidence list.');
 const claim=matches[0] as ClaimInput,number=claim.number;
 const percent=typeof number==='string'?/^(0|[1-9]\d{0,29})(?:\.(\d{1,2}))?%$/.exec(number):null;
 check(percent,'SEO_INPUT_INVALID','This source figure requires an exact percentage with at most two decimal places. Other numeric formats are not supported here.');
 const minor=BigInt(percent[1])*100n+BigInt((percent[2]??'').padEnd(2,'0'));
 const checked=await corroborateClaims({text:`${number} [claim:${claimId}]`,claims:[claim],competitors:data.competitors},net);
 check(checked.pass&&checked.claims[0]?.status==='corroborated','SEO_INPUT_INVALID','This exact claim needs two independent sources containing the recorded percentage.');
 const sources=checked.claims[0].sources;
 const body={operation:'seo.claim' as const,runRef:{kind:'delivery' as const,runId},currency,
  inputs:{tables:[{id:file.id,name:file.name,digest:file.digest},...sources.map(source=>({id:source.url,name:source.domain,digest:source.digest}))],columns:{manifestId:file.id,claimId,number},rowIds:[claimId]},
  steps:[{op:'match' as const,inputs:sources.map(source=>source.digest),result:number,rule:'The exact recorded percentage occurs in at least two independent public source domains.'}],
  figures:[{key:'claim-'+claimId,label:'Verified source claim',minor:String(minor),display:number,currency,unit:'percent' as const}],reconciliation:null,allowedNumbers:[number],
  explanation:'Source agreement verified by code against the exact page bytes. This does not independently establish that the claim is true.'};
 return {...body,digest:digest(body)};
}
export function sourceClaimUnchanged(receipt:WorkReceiptRecord,checked:Awaited<ReturnType<typeof checkedSourceClaim>>):boolean{return receipt.digest===checked.digest;}
