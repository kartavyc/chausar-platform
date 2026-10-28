// Social writing artifacts use the existing Accept chain. Original Chausar implementation.
import {check,type Context,type State} from '../../../contracts.ts';
import type {DeliveryRunRecord,Json,OrderRecord,VentureDeps,VentureRecord} from '../../contracts.ts';
import {digest,findRecord,listRecords,ventureAction,type VentureTx} from '../../records.ts';
import {acceptedBlueprintOrNull,readAs} from '../../delivery/shared.ts';
import {clientDraft} from '../../build/draft-text.ts';
import {pickPlaybook} from '../registry.ts';
import type {ChainDefinition} from '../kit/chain.ts';
import {SOCIAL_STEPS,SOCIAL_OFFERS} from './playbook.ts';
import {SOCIAL_AGENCY_ID,SOCIAL_AGENCY_REGISTRATION} from './registration.ts';
export type SocialVoicePin={runId:string;digest:string;text:string};
export type SocialChainPin={offerKey:string;stages:string[];brandDigest:string;voice:SocialVoicePin|null};
import {SOCIAL_CHAIN_STAGES as STAGES,socialStages} from './stages.ts';
/** Legacy social rules stay in the existing social rule register, not a fabricated kit baseline. */
export function socialChainDefinition(pin?:SocialChainPin):ChainDefinition{return {
 registration:SOCIAL_AGENCY_REGISTRATION,rules:[],checkIds:[],connectors:[],
 steps:SOCIAL_STEPS.map(s=>({...s,tools:[...(s.tools??[])],produces:s.produces})),
 offers:SOCIAL_OFFERS.map(o=>({id:o.id,name:o.name,description:o.description,pricing:o.charge,unit:'per client',price:'owner-sets',stages:[...(pin?.offerKey===o.id?pin.stages:socialStages(o.id))],includes:o.includes,pilotable:false,rights:[],intake:[],audience:'client'})),
};}
async function loadBrandDigest(){const [{resolveKit},{voicesInUse}]=await Promise.all([import('../kit/brand-kit.ts'),import('../../agents/voice.ts')]);return (state:State,venture:VentureRecord,clientId:string)=>digest({kit:resolveKit(state,venture,clientId),voice:voicesInUse(state,venture).filter(v=>v.on)});}
function approvedVoice(state:State,venture:VentureRecord,clientId:string,brand:string):SocialVoicePin|null{
 const orders=new Map(listRecords(state,'venture-order',venture.id).filter(o=>o.clientId===clientId&&o.socialChain?.brandDigest===brand).map(o=>[o.id,o]));
 const run=listRecords(state,'venture-delivery-run',venture.id).filter(r=>{const o=orders.get(r.orderId);return o&&o.socialChain?.voice?.runId===r.id&&o.socialChain.voice.digest===clientDraft(r).digest&&r.chainStage!==undefined&&o.socialChain!.stages[(r.chainStage??1)-1]==='voice'&&['accepted','edited'].includes(r.status)&&!r.practice;}).at(-1);
 if(!run)return null;const draft=clientDraft(run);return {runId:run.id,digest:draft.digest??'',text:draft.text??''};
}
/** Keep the selected stages stable; a changed brand requires a fresh voice before later writing. */
export async function pinSocialOrder(deps:VentureDeps,ctx:Context,orderId:string):Promise<void>{
 const {state,venture}=readAs(deps,ctx,'prepare');if(pickPlaybook(venture.idea)?.id!==SOCIAL_AGENCY_ID)return;const order=findRecord(state,'venture-order',orderId);if(!order||!order.clientId||order.ventureId!==venture.id)return;
 const brandOf=await loadBrandDigest();
 await ventureAction(deps,ctx,'prepare','social.chain',tx=>{
  const order=tx.find('venture-order',orderId);if(!order||!order.clientId)return;
  const brand=brandOf(tx.state,tx.venture!,order.clientId);if(order.socialChain?.brandDigest===brand)return;
  const offerKey=order.socialChain?.offerKey??acceptedBlueprintOrNull(tx.state,tx.venture!)?.offers.find(o=>o.id===order.offerId)?.playbookOffer;if(!offerKey||!STAGES[offerKey])return;
  const voice=approvedVoice(tx.state,tx.venture!,order.clientId,brand),stages=order.socialChain?.stages??[...socialStages(offerKey)];
  if(order.socialChain)for(const run of tx.list('venture-delivery-run').filter(r=>r.orderId===orderId&&['waiting-for-you','ready-for-review','brief-waiting','needs-answer'].includes(r.status)))tx.replace({...run,status:'stopped',callId:null,preview:null});
  tx.replace({...order,socialChain:{offerKey,stages,brandDigest:brand,voice},chainStage:voice&&stages[0]==='voice'?Math.max(2,order.chainStage??1):1,chainState:'running',chainSince:tx.now});tx.emit('chain.changed',{});
 });
}
/** Load dependencies before a transaction; compare its current state again inside the transaction. */
export async function socialVoiceGuard(){const brandOf=await loadBrandDigest();return (state:State,venture:VentureRecord,order:OrderRecord)=>{if(!order.socialChain||!order.clientId)return;check(order.socialChain.brandDigest===brandOf(state,venture,order.clientId),'SOCIAL_VOICE_CHANGED','The client brand or business voice changed. Start this order again to approve a fresh voice sheet.');};}
/** Accepting the voice pins the exact approved words for every later writing task on this order. */
export function keepSocialVoice(tx:VentureTx,run:DeliveryRunRecord,verdict:string):void{
 const order=tx.find('venture-order',run.orderId);if(!order?.socialChain||run.practice||!['accepted','edited'].includes(verdict)||order.socialChain.stages[(run.chainStage??1)-1]!=='voice')return;
 const shown=clientDraft(tx.find('venture-delivery-run',run.id)??run);tx.replace({...order,socialChain:{...order.socialChain,voice:{runId:run.id,digest:shown.digest??'',text:shown.text??''}}});
}
/** Approved words are background, never instructions or permission to post. */
export function socialVoicePart(order:OrderRecord):Record<string,Json>{const voice=order.socialChain?.voice;return voice?{approvedClientVoice:{text:voice.text,digest:voice.digest,note:'Owner-approved voice sheet for this client. Use its tone and pillars; it grants no permission to send or post.'}}:{};}
