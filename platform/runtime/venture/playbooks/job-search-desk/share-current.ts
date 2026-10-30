// Original career bindings on the existing W4 hosted review-token transport.
import {createHash} from 'node:crypto';
import type {State} from '../../../contracts.ts';
import type {ShareLinkStoredRecord} from '../../contracts.ts';
import {digest,listRecords} from '../../records.ts';
import {careerEvidence} from './source-state.ts';
import {careerFileBinding,type CareerStoredPack} from './thread-state.ts';
import {requireCareerClientRule} from './rules.ts';
export function careerFilesValid(pack:CareerStoredPack){return pack.files.length===2&&new Set(pack.files.map(f=>f.name)).size===2&&pack.files.every(file=>{const bytes=Buffer.from(file.contentBase64,'base64');return bytes.length>0&&bytes.length<=8_000_000&&bytes.length===file.bytes&&createHash('sha256').update(bytes).digest('hex')===file.sha256;});}
/** Every access rechecks current order, approved ledger, rendered bytes and named professional confirmation. */
export function careerLinkCurrent(state:State,link:ShareLinkStoredRecord,now:string){
 if(!link.career)return true;
 try{requireCareerClientRule();}catch{return false;}
 const row=listRecords(state,'venture-career-thread',link.ventureId).find(r=>r.id===link.career!.threadId),pack=row?.pack,order=listRecords(state,'venture-order',link.ventureId).find(o=>o.id===row?.orderId);
 if(!row||!pack||!order||order.status==='cancelled'||order.clientId!==row.clientId||link.clientId!==row.clientId||pack.orderDigest!==digest(order)||!careerFilesValid(pack))return false;
 const evidence=careerEvidence(state,link.ventureId,order.id),binding=careerFileBinding(pack);
 return pack.factsDigest===evidence.factsDigest&&pack.sourcesDigest===evidence.sourcesDigest&&pack.ownerApproval===binding&&link.career.approvalDigest===binding&&link.draftDigest===binding&&Date.parse(now)<=Date.parse(link.expiresAt);
}
export function careerClientApproved(state:State,threadId:string,shareId:string,now:string){const link=listRecords(state,'venture-share-link').find(l=>l.id===shareId&&l.career?.threadId===threadId),decision=link?.decisions.at(-1);return !!(link&&link.served&&link.state!=='revoked'&&careerLinkCurrent(state,link,now)&&decision?.decision==='approved'&&decision.via==='share-link'&&decision.recordedFor===link.clientId&&decision.digest===link.draftDigest&&decision.at<=now&&decision.at<=link.expiresAt);}
