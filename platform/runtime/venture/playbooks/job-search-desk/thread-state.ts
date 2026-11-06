// Original career pack state and exact file approval identity, shared with the fake desk.
import {check,digest} from '../../../portable.ts';
import type {CareerResearchPackInput} from './research-pack.ts';
import type {CareerPackInput} from './pack.ts';
import type {CareerPackFile} from './file-types.ts';
export type CareerStoredPack={input:CareerPackInput|CareerResearchPackInput;text:string;orderDigest:string;factsDigest:string;sourcesDigest:string;files:CareerPackFile[];generation:number;note:string|null;ownerApproval:string|null;clientShareId:string|null};
export function careerFileBinding(pack:CareerStoredPack){return digest({text:pack.text,orderDigest:pack.orderDigest,factsDigest:pack.factsDigest,sourcesDigest:pack.sourcesDigest,generation:pack.generation,files:pack.files.map(({contentBase64:_bytes,...metadata})=>metadata)});}
export function careerThreadUpdate(raw:Record<string,unknown>,today:string){
 check(raw.clientReported===true&&typeof raw.state==='string'&&['draft','waiting','replied','applied','interview','closed'].includes(raw.state),'INVALID_VENTURE_REQUEST','Record only what the client has confirmed.');
 const date=(v:unknown)=>{check(v===null||typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'INVALID_VENTURE_REQUEST','Use a real date or leave it blank.');return v as string|null;};
 const lastTouch=date(raw.lastTouch),nextTouch=date(raw.nextTouch);check(!lastTouch||lastTouch<=today,'INVALID_VENTURE_REQUEST','A completed touch cannot be in the future.');check(!lastTouch||!nextTouch||nextTouch>=lastTouch,'INVALID_VENTURE_REQUEST','The next touch must not precede the last one.');
 return {state:raw.state as 'draft'|'waiting'|'replied'|'applied'|'interview'|'closed',lastTouch,nextTouch};
}
