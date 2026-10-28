// Original Chausar S11, UGC-Factory MIT and superCMO Apache-2.0 workflow ideas only.
import { requireSocial, socialNumber, socialText } from './d2-core.ts';
export type ProductPhoto={id:string;digest:string;kind:'client'};
/** Code routes category; a synthetic substitute cannot stand in for the real product. */
export function adStyle(category:string,photo:ProductPhoto|null){requireSocial(photo?.kind==='client'&&socialText(photo.id,120)&&socialText(photo.digest,256),'PRODUCT_PHOTO_REQUIRED','Add a real product photo before preparing an ad.');requireSocial(['d2c','restaurant','property'].includes(category));return {style:category==='restaurant'?'food-detail':category==='property'?'guided-walkthrough':'product-demonstration',photo,capability:'handoff' as const,paidGeneration:'planned' as const};}
/** Approval binds the actual still set digest; it grants no automatic provider spend. */
export function approveStoryboard(board:{digest:string;stills:string[]},expected:string){requireSocial(board&&socialText(board.digest,256)&&Array.isArray(board.stills)&&board.stills.length>0&&board.stills.every(s=>socialText(s,120)));requireSocial(board.digest===expected,'APPROVAL_STALE','The storyboard changed. Review its stills again.');return board.digest;}
export function videoQuote(input:{durationMs:number;maxClipMs:number;unitMinor:string;storyboardDigest:string;approvedDigest:string|null;synthetic:boolean;customerPretence:boolean}){
 requireSocial(socialNumber(input.durationMs,600000)&&input.durationMs>0&&socialNumber(input.maxClipMs,600000)&&input.maxClipMs>0&&/^\d{1,15}$/.test(input.unitMinor)&&BigInt(input.unitMinor)>0n&&typeof input.synthetic==='boolean'&&typeof input.customerPretence==='boolean');
 requireSocial(!input.customerPretence,'CUSTOMER_PRETENCE','A synthetic presenter cannot speak as a customer.');requireSocial(socialText(input.storyboardDigest,256)&&input.approvedDigest===input.storyboardDigest,'SOCIAL_APPROVAL_REQUIRED','Approve the exact storyboard stills before a video quote.');
 const units=Math.ceil(input.durationMs/input.maxClipMs);return {units,totalMinor:(BigInt(units)*BigInt(input.unitMinor)).toString(),unitMinor:input.unitMinor,formula:'ceil(durationMs / maximumClipMs) * unitMinor',disclosure:input.synthetic?'Made with AI':null,capability:'handoff' as const,providerCalled:false as const};
}
