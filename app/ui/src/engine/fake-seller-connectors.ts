// Browser rehearsal cannot reach Shopify or a hosted buyer session. It validates exactly, then refuses unavailable access.
import {EngineError,type OrderLite,type BlueprintViewLite} from './types';
import type {W4DeskHost} from './fake-w4';import type {FakeDeskKind} from './fake-playbooks';
import {check} from '../../../../platform/runtime/portable';
import {shopifyDomain,shopifyAccount} from '../../../../platform/runtime/venture/build/shopify-admin-core';
import {storefrontConnection} from '../../../../platform/runtime/venture/build/storefront-assistant-core';
import {shopifyOrderBinding} from '../../../../platform/runtime/venture/playbooks/online-seller/shopify-state';
import {storefrontBinding} from '../../../../platform/runtime/venture/playbooks/online-seller/storefront-records';
import {sellerOwnerCaps} from '../../../../platform/runtime/venture/playbooks/online-seller/owner-form';
function exact(raw:unknown,keys:string[],required=keys):Record<string,unknown>{check(raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.getPrototypeOf(raw)===Object.prototype,'INVALID_VENTURE_REQUEST','Use one request object.');const p=raw as Record<string,unknown>;check(Object.keys(p).every(k=>keys.includes(k))&&required.every(k=>Object.hasOwn(p,k)),'INVALID_VENTURE_REQUEST','Use the exact required fields.');return p;}
function guarded<T>(run:()=>T):T{try{return run();}catch(error){if(error instanceof Error&&'code'in error)throw new EngineError(String(error.code),error.message);throw error;}}
export function fakeSellerConnectors(host:W4DeskHost):{kinds:Record<string,FakeDeskKind>}{
 const order=(id:unknown)=>{const row=(host.ask('venture.order.list',{}) as OrderLite[]).find(o=>o.id===id&&o.status==='open');check(row,'ORDER_NOT_FOUND','Choose an open seller order in this business.');const plan=host.ask('venture.blueprint.get',{}) as BlueprintViewLite|null,offer=plan?.blueprint.offers.find(o=>o.id===row.offerId);check(offer?.playbookOffer&&['own-shop-back-office','listing-health-audit','reimbursement-audit','unit-economics-monthly','ads-health-check','catalogue-upload','product-research','multi-store-report','product-photos','case-tracker'].includes(offer.playbookOffer),'SELLER_INPUT_INVALID','Choose a seller order.');const venture=host.ask('venture.get',{}) as {paused?:unknown}|null;check(!venture?.paused,'BUSINESS_PAUSED','This business is paused.');return row;};
 const kind=(name:'shopify'|'storefront'):FakeDeskKind=>({
  list:p=>guarded(()=>{exact(p,name==='shopify'?['playbook','kind','filter']:['playbook','kind'],['playbook','kind']);check(p.filter===undefined,'INVALID_VENTURE_REQUEST','The Shopify list takes no filter.');return {playbook:'online-seller',kind:name,rows:[],line:name==='shopify'?'Owner stores. Each change asks separately.':'Owner shops. Every AI question waits for its own approval.'};}),
  get:p=>guarded(()=>{exact(p,['playbook','kind','id']);const row=order(p.id);return {playbook:'online-seller',kind:name,digest:name==='shopify'?shopifyOrderBinding(row):storefrontBinding(row),item:name==='shopify'?{orderId:row.id,remote:null,connected:false,rehearsal:true}:{orderId:row.id,config:null,pending:[],legalConfirmed:false,hosted:host.hosted(),rehearsal:true}};}),
  act:p=>guarded(()=>{exact(p,['playbook','kind','id','action','payload','digest']);const row=order(p.id),binding=name==='shopify'?shopifyOrderBinding(row):storefrontBinding(row);check(p.digest===binding,'APPROVAL_STALE',name==='shopify'?'Review the current store before continuing.':'Review the current store assistant settings.');
   if(name==='shopify'){
    if(p.action==='connect'){const b=exact(p.payload,['domain','clientId','clientSecret','ownStore','caps']);check(b.ownStore===true,'SHOPIFY_SETUP_REQUIRED','This route is only for an app in your own Shopify organization.');const domain=shopifyDomain(b.domain);sellerOwnerCaps(b.caps);check(typeof b.clientId==='string'&&typeof b.clientSecret==='string','SHOPIFY_SETUP_REQUIRED','Paste the exact owner app credentials as text.');shopifyAccount({domain,clientId:b.clientId,clientSecret:b.clientSecret});throw new EngineError('SHOPIFY_API_REFUSED','Shopify did not confirm this request. Check its admin before trying any change again.');}
    throw new EngineError('SHOPIFY_SETUP_REQUIRED','Connect the owner app first.');
   }
   if(p.action==='configure'){const b=exact(p.payload,['domain','publicToken','maxPages','modelConnectionId','language','notice','ownStore']);check(b.ownStore===true&&typeof b.domain==='string'&&typeof b.publicToken==='string'&&typeof b.maxPages==='number'&&typeof b.modelConnectionId==='string'&&(b.language==='en'||b.language==='hi')&&typeof b.notice==='string'&&b.notice.trim().length>=10&&b.notice.length<=2000,'STOREFRONT_SETUP_REQUIRED','Use your own shop, its public token, model, language and purpose notice.');storefrontConnection({domain:b.domain,publicToken:b.publicToken,maxPages:b.maxPages});throw new EngineError('SHOPIFY_API_REFUSED','The public catalogue could not be read. Check its token and store.');}
   throw new EngineError('STOREFRONT_SETUP_REQUIRED','Set up this owner shop first.');
  })
 });
 return {kinds:{shopify:kind('shopify'),storefront:kind('storefront')}};
}
