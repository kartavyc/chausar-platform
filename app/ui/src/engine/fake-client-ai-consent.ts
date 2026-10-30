import { clientAiConsentView } from '../../../../platform/runtime/venture/clients/ai-consent-core';
import { EngineError, type ClientLite, type ClientAiConsentView } from './types';

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
