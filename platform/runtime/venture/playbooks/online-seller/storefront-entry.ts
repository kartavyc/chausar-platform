// Original trusted hosted Storefront entry. Public requests only prepare memory-only owner questions, never dispatch AI.
import {check,hash,type Context} from '../../../contracts.ts';
import type {VentureDeps} from '../../contracts.ts';
import {digest,exactPayload,listRecords,currentVenture,ventureAction} from '../../records.ts';
import {currentShopify} from './shopify-runtime.ts';
import {storefrontSessions} from '../../build/storefront-assistant-memory.ts';
import {prepareStorefrontModel} from '../../build/storefront-assistant-model.ts';
import {requireStorefrontPermission} from './storefront-permission.ts';
export {STOREFRONT_PERMISSION_RULE,requireStorefrontPermission} from './storefront-permission.ts';
import {storefrontBinding} from './storefront-records.ts';
export {storefrontBinding} from './storefront-records.ts';
export function liveStorefront(deps:VentureDeps,ctx:Context,orderId:string){const found=currentShopify(deps,ctx,orderId),config=found.order.sellerStorefront;check(config,'STOREFRONT_SETUP_REQUIRED','Set up this owner shop first.');return {...found,config,binding:storefrontBinding(found.order)};}
export function activeStorefront(deps:VentureDeps,ctx:Context,orderId:string){const live=liveStorefront(deps,ctx,orderId);requireStorefrontPermission();check(live.config.active&&live.config.link&&Date.parse(live.config.link.expiresAt)>deps.clock().getTime(),'STOREFRONT_PAUSED','This shop assistant is paused. Open the shop meanwhile.');check(deps.clock().getTime()-Date.parse(live.config.readAt)<15*60*1000,'STOREFRONT_CATALOGUE_STALE','The owner must refresh this catalogue before another AI request. Open the shop for current products.');return live;}
/** Only VentureHost's trusted public route may reach this function. No owner RPC accepts the flag. */
export async function storefrontEntry(deps:VentureDeps,ctx:Context,token:string,input:unknown){
 if(deps.host!=='hosted-web'||!deps.publicUrl||!/^[A-Za-z0-9_-]{32}$/.test(token))return null;const state=deps.store.read(),venture=currentVenture(state);if(!venture)return null;const order=listRecords(state,'venture-order',venture.id).find(o=>o.sellerStorefront?.active&&o.sellerStorefront.link?.tokenHash===hash(token)&&Date.parse(o.sellerStorefront.link.expiresAt)>deps.clock().getTime());if(!order)return null;
 const b=exactPayload(input,['operation','session','question','consent'],['operation']),live=liveStorefront(deps,ctx,order.id),config=live.config;requireStorefrontPermission();
 const page={language:config.language,notice:config.notice,disclosure:'You are chatting with an AI assistant',shopUrl:'https://'+config.domain,readAt:config.readAt,privateNotice:'Your product question goes to this shop owner and, after their approval, their AI provider. Do not include personal or payment details. Chausar removes chat text at session end or after ten minutes. Provider retention follows the owner provider terms.'};
 if(b.operation==='page'){exactPayload(b,['operation'],['operation']);return page;}
 const sessions=storefrontSessions(deps);
 if(b.operation==='start'){exactPayload(b,['operation','consent'],['operation','consent']);check(b.consent===true,'STOREFRONT_CONSENT_REQUIRED','Agree to this exact notice before starting the chat.');activeStorefront(deps,ctx,order.id);const opened=sessions.open(state.workspace.id,order.id,live.binding);return {...page,session:opened.token,expiresAt:opened.expiresAt};}
 check(typeof b.session==='string','STOREFRONT_SESSION_EXPIRED','Start a new chat.');const scope=sessions.scope(b.session);check(scope.businessId===state.workspace.id&&scope.orderId===order.id&&scope.configDigest===live.binding,'APPROVAL_STALE','The store or notice changed. Start a fresh chat.');
 if(b.operation==='end'){exactPayload(b,['operation','session'],['operation','session']);sessions.end(b.session);return {ended:true};}
 if(b.operation==='poll'){exactPayload(b,['operation','session'],['operation','session']);return sessions.poll(b.session);}
 check(b.operation==='ask','INVALID_VENTURE_REQUEST','Choose a supported chat action.');exactPayload(b,['operation','session','question'],['operation','session','question']);activeStorefront(deps,ctx,order.id);check(typeof b.question==='string','STOREFRONT_QUESTION_INVALID','Ask a short product question.');const prepared=prepareStorefrontModel(deps,ctx,{connectionId:config.modelConnectionId,question:b.question,catalogue:config.catalogue,domain:config.domain,binding:live.binding});sessions.ask(b.session,b.question,prepared.quote);try{await ventureAction(deps,ctx,'prepare','storefront.request-ready',tx=>{check(activeStorefront(deps,ctx,order.id).binding===live.binding,'APPROVAL_STALE','The owner store settings changed.');tx.emit('desk.changed',{playbook:'online-seller',id:order.id});});check(activeStorefront(deps,ctx,order.id).binding===live.binding,'APPROVAL_STALE','The owner store settings changed.');sessions.scope(b.session);}catch(error){sessions.end(b.session);throw error;}return {phase:'waiting',answer:null};
}
