// Source-derived gaps are one owner request per bid, never a stored capability claim.
import test from 'node:test';import assert from 'node:assert/strict';
import {tenderGapRows} from '../runtime/venture/playbooks/tender-desk/rows.ts';
import {setup,owner,seedBlueprint,seedOrder} from './venture-views-env.ts';
import {ventureAction,digest} from '../runtime/venture/records.ts';
import {TENDER_DESK_DESK} from '../runtime/venture/playbooks/tender-desk/desk.ts';
test('Today aggregates missing terms from all bid questions into one current source-backed request',async()=>{
 const env=await setup(),{order}=await seedOrder(env,await seedBlueprint(env));const file=await ventureAction(env.deps,owner,'prepare','tender.queue-fixture',tx=>{tx.replace({...tx.find('venture-order',order.id)!,intake:{rights:null,format:'long',aiVoice:false,aiPresenter:false,paidPromotion:false,cutFile:null,fields:{rfpText:'Describe hosting.\nDescribe hosting and support.'}}});const text='We provide support.';return tx.put({...tx.base('venture-upload'),name:'company.txt',format:'csv',bytes:text.length,digest:digest(text),contentBase64:Buffer.from(text).toString('base64'),scope:{kind:'order',orderId:order.id},clientData:true});});
 env.published.length=0;
 await TENDER_DESK_DESK.bid.act!(env.deps,owner,{playbook:'tender-desk',kind:'bid',id:order.id,action:'import',payload:{rfpFileId:null,documentFileIds:[file.id],issuerFileId:null,mapping:null}});
 assert.ok(env.published.flat().some(event=>event.name==='queue.changed'),'Today must refresh after source import');
 const rows=await tenderGapRows(env.deps,owner,env.store.read(),env.venture);assert.equal(rows.length,1);assert.match(rows[0].line!,/hosting/i);assert.equal(rows[0].subject,'tender-gap:'+order.id);assert.match(rows[0].notice!.link!,/tenderOrder/);
});
