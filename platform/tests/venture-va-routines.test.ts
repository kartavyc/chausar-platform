import test from 'node:test';import assert from 'node:assert/strict';
import {kitBusiness,installKitFixture,owner} from './fixtures/venture/kit-business.ts';
import {ventureAction} from '../runtime/venture/records.ts';
import {listRecords} from '../runtime/venture/records.ts';
import {routinesSetHandler} from '../runtime/venture/agents/routines.ts';
import {runRoutines} from '../runtime/venture/agents/routine-runner.ts';
import {net,personNamed} from './venture-network-env.ts';
import {vaRecordReport,vaRoutinePreset} from '../runtime/venture/playbooks/virtual-assistant/routines.ts';
test('morning and weekly reports quote saved mail, monitors and Today with one source per line and no model or network',async t=>{
 const undo=installKitFixture();t.after(undo);const e=await kitBusiness();let external=0;e.deps.net={resolve:async()=>{external++;throw Error('No network');}};
 await ventureAction(e.deps,owner,'approve','test.va-sources',tx=>{
  tx.put({...tx.base('venture-inbound'),messageId:'message-1',from:'asha@example.com',to:[],date:tx.now,subject:'Venue shortlist needed',references:[],matched:null,triage:'unknown',line:'Unmatched email',processed:false,screen:null} as never);
  tx.put({...tx.base('venture-monitor'),url:'https://example.com/venues',host:'example.com',watch:'change',text:null,selector:null,belowMinor:null,seeded:true,lastDigest:'a'.repeat(64),lastValue:null,lastCheckedAt:tx.now,nextCheckAt:tx.now,failures:0,lastError:null,alerts:[],removedAt:null,line:'No change recorded.'});
 });
 const report=await vaRecordReport(e.deps,owner,'morning');assert.ok(report.lines.some(l=>l.source.kind==='mail'));assert.ok(report.lines.some(l=>l.source.kind==='monitor'));assert.ok(report.lines.every(l=>l.source.id&&l.source.digest));assert.ok(report.text.includes('Venue shortlist needed'));assert.equal(external,0);assert.equal(e.models.previewed.length,0);assert.equal(report.private,true);
 for(const kind of ['morning','weekly'] as const){const preset=vaRoutinePreset(kind,'Asia/Kolkata');assert.equal(preset.recordReport,'va-'+kind);assert.equal(preset.schedule.kind,'calendar');assert.equal(preset.on,false);assert.equal(preset.agent,null);}
});
test('record reports use the existing routine approval queue and private chat without spending on a model',async()=>{
 const e=await kitBusiness(undefined,{idea:'A virtual assistant service'}),preset=vaRoutinePreset('morning','Asia/Kolkata'),input={...preset,on:true,schedule:{kind:'once' as const,at:new Date(e.clock.now.getTime()+60000).toISOString()}};
 await assert.rejects(routinesSetHandler(e.deps,{...owner,channel:'agent' as never},{routine:input}),{code:'APP_APPROVAL_REQUIRED'});
 const saved=await routinesSetHandler(e.deps,owner,{routine:input});assert.equal(listRecords(e.store.read(),'venture-routine')[0]?.recordReport,'va-morning');assert.doesNotMatch(saved.routine.line,/goes to your AI/);
 e.clock.now=new Date(e.clock.now.getTime()+60000);await runRoutines(e.deps,owner);assert.equal(listRecords(e.store.read(),'venture-chief-message').length,0,'a scheduled occurrence waits');
 const row=(await e.call('venture.queue.list')).rows.find((r:{id:string})=>r.id.startsWith('routine:'));assert.ok(row);const result=await e.call('venture.queue.decide',{id:row.id,digest:row.digest,action:'approve'});assert.equal(result.outcome,'done',JSON.stringify(result));
 const messages=listRecords(e.store.read(),'venture-chief-message');assert.ok(messages.some(m=>m.author==='engine'));assert.equal(e.models.previewed.length,0);assert.equal(e.models.generated.length,0);assert.equal(listRecords(e.store.read(),'venture-routine-run')[0]?.state,'completed');
 await assert.rejects(routinesSetHandler(e.deps,owner,{routine:{...input,agent:'assistant'}}),{code:'INVALID_VENTURE_REQUEST'});
 await net(e,'venture.network.import',{kind:'contacts-csv',name:'contacts.csv',text:'Name,E-mail 1 - Value\nAsha Rao,asha@example.com'});const person=personNamed(e as never,'Asha Rao');await net(e,'venture.network.forget',{id:person.id});
 assert.equal(listRecords(e.store.read(),'venture-chief-message').filter(m=>m.author==='engine').length,0,'regenerable private record reports leave no copied source words after Forget');
});
