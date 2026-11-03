import { clientAiConsentView } from '../../../../platform/runtime/venture/clients/ai-consent-core';
import { EngineError, type ClientLite, type ClientAiConsentView } from './types';
import type {W4DeskHost} from './fake-w4';

type ClientAiBinding={ventureId:string;orderId:string;clientId:string;consentId:string;consentRevision:number};
/** Same separate client grant as the native retained desk helpers. Request approval cannot replace it. */
export function bindFakeClientAi(host:Pick<W4DeskHost,'ask'>,orderId:string,preview?:{clientAi?:ClientAiBinding}):ClientAiBinding {
  const venture=(host.ask('venture.get',{}) as {venture?:{id?:string}}|null)?.venture;
  const orders=host.ask('venture.order.list',{}) as {id:string;clientId:string;status?:string}[],order=Array.isArray(orders)?orders.find(order=>order.id===orderId):undefined;
  if(!venture?.id||!order)throw new EngineError('ORDER_NOT_FOUND','Choose an order from this business.');
  if(order.status==='cancelled')throw new EngineError('JOB_SOURCE_CHANGED','The client order changed before this AI request finished.');
  const expected=preview?.clientAi;
  if(preview&&(!expected||expected.ventureId!==venture.id||expected.orderId!==orderId||expected.clientId!==order.clientId))throw new EngineError('CLIENT_AI_CONSENT_CHANGED','This client AI permission changed. Prepare a new request.');
  const clients=host.ask('venture.client.list',{}) as ClientLite[],client=Array.isArray(clients)?clients.find(client=>client.id===order.clientId):undefined;
  if(!client)throw new EngineError('CLIENT_NOT_FOUND','Choose a client from this business.');
  const consent=client.aiConsent;
  if(!consent||consent.withdrawnAt)throw new EngineError('CLIENT_AI_CONSENT_REQUIRED','Allow this client’s data to reach your AI before starting their work.');
  if(expected&&(consent.id!==expected.consentId||consent.revision!==expected.consentRevision))throw new EngineError('CLIENT_AI_CONSENT_CHANGED','This client’s AI permission changed. Start a new job.');
  return {ventureId:venture.id,orderId,clientId:client.id,consentId:consent.id,consentRevision:consent.revision};
}

/** The fake's app request surface has no model caller. Consent is part of the client, so Forget removes it too. */
export function fakeClientAiConsent(method:string,raw:unknown,host:{clients:ClientLite[];ventureId:string;now:()=>string;changed:()=>void}):ClientAiConsentView {
  if(!['venture.client.aiConsent.get','venture.client.aiConsent.agree','venture.client.aiConsent.withdraw'].includes(method))throw new EngineError('METHOD_NOT_ALLOWED','Choose a client permission action.');
  const required=method==='venture.client.aiConsent.agree'?['clientId','disclosureDigest']:['clientId'];
  if(!raw || typeof raw!=='object' || Array.isArray(raw) || ![Object.prototype,null].includes(Object.getPrototypeOf(raw)))throw new EngineError('INVALID_VENTURE_REQUEST','Send one request object.');
  const p=raw as Record<string,unknown>;
  if(Object.keys(p).some(key=>!required.includes(key)) || required.some(key=>!Object.hasOwn(p,key)))throw new EngineError('INVALID_VENTURE_REQUEST','Send the required fields and nothing else.');
  if(typeof p.clientId!=='string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(p.clientId))throw new EngineError('INVALID_VENTURE_REQUEST','Client must be a known identifier.');
  const client=host.clients.find(item=>item.id===p.clientId);if(!client)throw new EngineError('CLIENT_NOT_FOUND','Choose a client from this business.');
  const view=()=>clientAiConsentView({...client,ventureId:host.ventureId});
  if(method==='venture.client.aiConsent.agree') {
    const current=view();if(p.disclosureDigest!==current.disclosureDigest)throw new EngineError('CLIENT_AI_CONSENT_CHANGED','Read the current permission and confirm it again.');
    if(current.status!=='agreed') {
      const revision=(client.aiConsent?.revision??0)+1;
      client.aiConsent={id:`aiconsent_${host.ventureId}_${client.id}_${revision}`,revision,disclosureDigest:current.disclosureDigest,grantedAt:host.now(),grantedBy:'owner',withdrawnAt:null};host.changed();
    }
  } else if(method==='venture.client.aiConsent.withdraw' && client.aiConsent && !client.aiConsent.withdrawnAt) {
    client.aiConsent={...client.aiConsent,revision:client.aiConsent.revision+1,withdrawnAt:host.now()};host.changed();
  }
  return structuredClone(view());
}
