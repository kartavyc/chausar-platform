import {fakeClientAiConsent} from '../../src/engine/fake-client-ai-consent';
import type {ClientLite} from '../../src/engine/types';
import type {W4DeskHost} from '../../src/engine/fake-w4';

/** Explicit test permission, granted only when a positive AI test calls agree(). */
export function fixtureClientAi(host:W4DeskHost,clientId:string){
  const clients:ClientLite[]=[{id:clientId,name:'Fictional client',at:host.now(),email:null,countryCode:null,taxId:null,stateCode:null,note:null}],ask=host.ask;
  const venture=()=>{const original=ask('venture.get',{}) as {venture?:Record<string,unknown>}|null;return {...original,venture:{...original?.venture,id:typeof original?.venture?.id==='string'?original.venture.id:'venture_'+host.current()}};};
  host.ask=(method,params)=>method==='venture.client.list'?clients:method==='venture.get'?venture():ask(method,params);
  const permission=()=>({clients,ventureId:String(venture().venture.id),now:()=>host.now(),changed:()=>{}});
  return {clients,agree(){const view=fakeClientAiConsent('venture.client.aiConsent.get',{clientId},permission());return fakeClientAiConsent('venture.client.aiConsent.agree',{clientId,disclosureDigest:view.disclosureDigest},permission());},withdraw(){return fakeClientAiConsent('venture.client.aiConsent.withdraw',{clientId},permission());}};
}
