// Original owner setup for open publishing. Credentials stay on the memory-only shelf and every reconnect invalidates old proposals.
import {check,type State} from '../../contracts.ts';
import type {VentureDeps,OpenPostingAccountRecord,Json} from '../contracts.ts';
import {currentVenture,digest,exactPayload,listRecords,requireAppChannel,ventureAction} from '../records.ts';
import {readAs} from '../delivery/shared.ts';
import type {DeskHandlers} from '../playbooks/desk-types.ts';
import {socialDomainError} from '../playbooks/social/inbox-desk.ts';
import {connectOpenPosting} from './open-posting.ts';
import {openSetup,type OpenPlatform,type OpenPostingAccount,type OpenAccountView} from './open-posting-core.ts';
export const OPEN_PLATFORMS=['bluesky','mastodon','telegram','discord'] as const;
export const isOpenPlatform=(id:string):id is OpenPlatform=>(OPEN_PLATFORMS as readonly string[]).includes(id);
export type {OpenAccountView} from './open-posting-core.ts';
export type OpenPostingDeskTypes={'open-posting':{filter:null;row:OpenAccountView;item:OpenAccountView;actions:Record<string,{payload:Json;result:OpenAccountView}>}};
export function openAccountRecord(state:State,platform:string){const venture=currentVenture(state);return venture?listRecords(state,'venture-open-posting-account',venture.id).find(v=>v.account.platform===platform):undefined;}
export function openSecretName(ventureId:string,platform:string):`open-post:${string}`{return `open-post:${ventureId}:${platform}`;}
export function openAccountIdentity(account:OpenPostingAccount){return account.server+'|'+account.accountId+'|'+account.destinationId;}
export function connectedOpenAccount(deps:VentureDeps,platform:string){const record=openAccountRecord(deps.store.read(),platform);const credential=record?deps.secrets.get(openSecretName(record.ventureId,platform)):null;return record&&record.active&&credential?{record,credential}:null;}
function view(deps:VentureDeps,platform:OpenPlatform):OpenAccountView{const row=openAccountRecord(deps.store.read(),platform);return{id:platform,account:row?.active?row.account:null,digest:digest(row??null),connected:!!connectedOpenAccount(deps,platform),revision:row?.revision??0};}
/** Setup verifies only the displayed account. No post is implied, queued or sent by a connection. */
export const OPEN_POSTING_DESK:DeskHandlers={'open-posting':{
 async list(deps,ctx,p){exactPayload(p,['playbook','kind','filter'],['playbook','kind']);check(p.filter===undefined||p.filter===null,'INVALID_VENTURE_REQUEST','Account setup has no filter.');readAs(deps,ctx,'read');return{playbook:'social-agency',kind:'open-posting',rows:OPEN_PLATFORMS.map(id=>view(deps,id)),line:'Connect your own account. Each post still needs separate approval.'};},
 async get(deps,ctx,p){exactPayload(p,['playbook','kind','id'],['playbook','kind','id']);readAs(deps,ctx,'read');check(isOpenPlatform(p.id),'OPEN_POSTING_INPUT','Choose an available open network.');const item=view(deps,p.id);return{playbook:'social-agency',kind:'open-posting',item,digest:item.digest};},
 async act(deps,ctx,p){try{requireAppChannel(ctx,'venture.desk.act');exactPayload(p,['playbook','kind','id','action','payload','digest'],['playbook','kind','id','action','payload']);const initial=readAs(deps,ctx,'approve');check(isOpenPlatform(p.id)&&['connect','disconnect'].includes(p.action),'OPEN_POSTING_INPUT','Choose an account action.');const platform=p.id,old=openAccountRecord(initial.state,platform),expected=digest(old??null);check(p.digest===expected||!old&&p.digest===undefined,'APPROVAL_STALE','The account changed. Review its current settings.');
  const guard=()=>{const live=readAs(deps,ctx,'approve');check(live.venture.id===initial.venture.id&&digest(openAccountRecord(live.state,platform)??null)===expected,'APPROVAL_STALE','The account changed while connecting.');const held=listRecords(live.state,'venture-channel-hold',live.venture.id).some(h=>h.connectorId===platform&&(h.cause==='challenge'?h.clearedAt===null:!!h.until&&h.until>deps.clock().toISOString()));check(!held,'CHANNEL_HELD','This network is paused. Resolve its restriction before connecting again.');};
  if(p.action==='disconnect'){exactPayload(p.payload,[]);await ventureAction(deps,ctx,'approve','open-posting.disconnect',tx=>{guard();const row=openAccountRecord(tx.state,platform);if(row)tx.replace({...row,active:false,revision:row.revision+1});tx.emit('desk.changed',{playbook:'social-agency',kind:'open-posting',id:platform});});deps.secrets.delete(openSecretName(initial.venture.id,platform));return{playbook:'social-agency',kind:'open-posting',id:platform,result:view(deps,platform),line:'Disconnected. Existing uncertain posts still need inspection.'};}
  const input=exactPayload(p.payload,['setup','credential'],['setup','credential']),setup=openSetup(input.setup as never);check(setup.platform===platform&&typeof input.credential==='string','OPEN_POSTING_INPUT','Approve this exact account setup.');guard();const connected=await connectOpenPosting(setup,input.credential,deps.net,guard);guard();await ventureAction(deps,ctx,'approve','open-posting.connect',tx=>{guard();const previous=openAccountRecord(tx.state,platform);const saved:OpenPostingAccountRecord={...(previous??tx.base('venture-open-posting-account')),account:connected.account,active:true,revision:(previous?.revision??0)+1};if(previous)tx.replace(saved);else tx.put(saved);tx.emit('desk.changed',{playbook:'social-agency',kind:'open-posting',id:platform});});deps.secrets.set(openSecretName(initial.venture.id,platform),connected.credential);return{playbook:'social-agency',kind:'open-posting',id:platform,result:view(deps,platform),line:'Account verified for this session. No post was sent.'};
 }catch(error){socialDomainError(error);}
 }
}};
