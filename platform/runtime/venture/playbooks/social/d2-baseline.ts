// Original Chausar D2 held-back checks run the domain cores on the retained source, not phrases alone.
import {requireSocial} from './d2-core.ts';import {montagePlan} from './montage.ts';import {keywordDelivery} from './local-ig.ts';import {adStyle} from './ad-style.ts';import {diagnosePost} from './diagnosis.ts';
export function socialD2Baseline(id:string,source:string,draft:Record<string,unknown>):string[]{try{const input=JSON.parse(source);requireSocial(input&&typeof input==='object');
 if(id==='reel-end-card'){const plan=montagePlan(input);requireSocial(draft.contact===plan.endCard.contact&&draft.durationMs===plan.durationMs);}
 else if(id==='keyword-comment-delivery'){const expected=keywordDelivery(input.promise,input.question);requireSocial(JSON.stringify(draft.messages)===JSON.stringify(expected.messages));}
 else if(id==='video-ad-no-photo'){requireSocial(input.category==='restaurant'&&Object.hasOwn(input,'photo'));let refused=false;try{adStyle(input.category,input.photo);}catch(error){refused=(error as {code?:string}).code==='PRODUCT_PHOTO_REQUIRED';}requireSocial(refused&&draft.outcome==='blocked'&&draft.code==='PRODUCT_PHOTO_REQUIRED');}
 else if(id==='diagnosis-labelled'){const measured=diagnosePost(input);requireSocial(draft.label===measured.modelLabel&&JSON.stringify(draft.findings)===JSON.stringify(measured.findings));}
 else requireSocial(false);return [];
 }catch{return ['The source-bound social domain check did not pass.'];}}
