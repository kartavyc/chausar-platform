// Real persisted rows bind source drafts and their final saved outcomes independently of model claims.
import test from 'node:test';import assert from 'node:assert/strict';
import {formsFixture} from './venture-forms-env.ts';import {owner} from './venture-views-env.ts';
import {ventureAction,readVenture} from '../runtime/venture/records.ts';
import {formsRunSource,formsRunCurrent} from '../runtime/venture/playbooks/data-entry-desk/run-source.ts';
import {formArtifact} from '../runtime/venture/playbooks/data-entry-desk/checks.ts';
import type {DeliveryRunRecord} from '../runtime/venture/contracts.ts';
test('R2 delivery source guards reject changed bytes, reassignment and invented saved outcomes',async()=>{const f=await formsFixture(),prepared=await f.act('prepare',{orderId:f.order.id,fileId:f.file.id,identityColumn:'Record',rowIndex:0}),id=prepared.id;
 await ventureAction(f.env.deps,owner,'approve','test.forms-map',tx=>{const row=tx.find('venture-entry-record',id)!;tx.replace({...row,pageHash:'page',mappingProposal:{sourceDigest:row.sourceDigest,pageHash:'page',mapping:[{column:'Customer',targetId:'target'}]}});});
 const read=()=>readVenture(f.env.deps,owner),source=()=>{const r=read();return formsRunSource(r.state,r.venture.id,f.order.id);},before=source();assert.equal(before.rows[0].values.Customer,'Asha');
 const run={orderId:f.order.id,formsSourceBinding:before.binding,chainStage:1,deliverable:{title:'Mapping',sections:[{heading:'Field mapping',parts:[{kind:'text',text:formArtifact(before.rows,'mapping')}]}]}} as DeliveryRunRecord;
 assert.doesNotThrow(()=>formsRunCurrent(read().state,read().venture.id,run));
 await ventureAction(f.env.deps,owner,'approve','test.changed-result',tx=>{const row=tx.find('venture-entry-record',id)!;tx.replace({...row,mappingProposal:undefined});});
 assert.throws(()=>formsRunCurrent(read().state,read().venture.id,run),{code:'FORM_SOURCE_CHANGED'});
 await ventureAction(f.env.deps,owner,'approve','test.changed-source',tx=>{const file=tx.find('venture-upload',f.file.id)!;tx.replace({...file,contentBase64:Buffer.from('Record,Customer\n0001,Other').toString('base64')});});assert.throws(source,{code:'FORM_SOURCE_CHANGED'});
});
