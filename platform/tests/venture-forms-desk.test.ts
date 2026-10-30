// Public owner desk boundary on real source records. Synthetic clients only; no outside browser calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,owner,seedBlueprint,seedOrder} from './venture-views-env.ts';
import {ventureAction,listRecords} from '../runtime/venture/records.ts';
import {filesAddHandler} from '../runtime/venture/delivery/harness/files.ts';
import {DATA_ENTRY_DESK_DESK} from '../runtime/venture/playbooks/data-entry-desk/desk.ts';
import {formsFixture as fixture} from './venture-forms-env.ts';
test('R2 owner desk prepares an exact stable source row and reports changed source as stale',async()=>{
 const f=await fixture();const made=await f.act('prepare',{orderId:f.order.id,fileId:f.file.id,identityColumn:'Record',rowIndex:0});assert.equal((made.result as any).sourceRecordId,'0001');const current=await f.get(made.id);assert.equal((current.item as any).source.values.Customer,'Asha');await ventureAction(f.env.deps,owner,'approve','forms.replace-source',tx=>{const file=tx.find('venture-upload',f.file.id)!;tx.replace({...file,contentBase64:Buffer.from('Record,Customer\n0001,Different').toString('base64')});});assert.equal(((await f.get(made.id)).item as any).stale,true);
});
test('R2 source preparation refuses wrong playbook, revoked consent, cross-order uploads and viewer writes',async()=>{
 const f=await fixture(),payload={orderId:f.order.id,fileId:f.file.id,identityColumn:'Record',rowIndex:0};await f.env.store.update(state=>state.members.push({id:'viewer',name:'Viewer',role:'viewer',active:true,epoch:1,branches:['*']}));await assert.rejects(DATA_ENTRY_DESK_DESK.entries!.act!(f.env.deps,{...owner,memberId:'viewer',role:'viewer'},{playbook:'data-entry-desk',kind:'entries',action:'prepare',id:'new',payload}),{code:'FORBIDDEN'});
 await ventureAction(f.env.deps,owner,'approve','forms.move-upload',tx=>{const file=tx.find('venture-upload',f.file.id)!;tx.replace({...file,scope:{kind:'order',orderId:'other-order'}});});await assert.rejects(f.act('prepare',payload),{code:'FORM_SOURCE_INVALID'});await ventureAction(f.env.deps,owner,'approve','forms.restore-upload',tx=>{const file=tx.find('venture-upload',f.file.id)!;tx.replace({...file,scope:{kind:'order',orderId:f.order.id}});});
 await ventureAction(f.env.deps,owner,'approve','forms.revoke',tx=>{const order=tx.find('venture-order',f.order.id)!;tx.replace({...order,intake:{...order.intake!,fields:{'data-consent':false}}});});await assert.rejects(f.act('prepare',payload),{code:'FORM_CONSENT_REQUIRED'});await ventureAction(f.env.deps,owner,'approve','forms.wrong-kit',tx=>{const order=tx.find('venture-order',f.order.id)!;tx.replace({...order,intake:{...order.intake!,fields:{'data-consent':true}}});const blueprint=tx.find('venture-blueprint',tx.venture!.acceptedBlueprintId!)!;tx.replace({...blueprint,offers:blueprint.offers.map(offer=>({...offer,playbookOffer:'seller-research'}))});});await assert.rejects(f.act('prepare',payload),{code:'FORM_ORDER_REQUIRED'});
 assert.equal(listRecords(f.env.store.read(),'venture-entry-record').length,0);
});
