// Public delivery stays tied to actual data-entry records. The browser itself is tested with the local TLS fixture.
import test from 'node:test';import assert from 'node:assert/strict';
import {kitBusiness,owner,approveWaiting,draft} from './fixtures/venture/kit-business.ts';
import {definePlaybook} from '../runtime/venture/playbooks/kit/define.ts';
import {installTestPlaybooks} from '../runtime/venture/playbooks/kit/installed.ts';
import {FORMS_DATA,FORMS_HI} from '../runtime/venture/playbooks/data-entry-desk/definition-data.ts';
import {formsRunSource} from '../runtime/venture/playbooks/data-entry-desk/run-source.ts';
import {FORMS_ACCESS_RULE} from '../runtime/venture/playbooks/data-entry-desk/rules.ts';
import {formArtifact} from '../runtime/venture/playbooks/data-entry-desk/checks.ts';
import {listRecords,ventureAction} from '../runtime/venture/records.ts';
test('R2 public mapping workflow reads real source, rejects invented outcomes and invalidates after source edit',async t=>{
 t.after(installTestPlaybooks([{definition:definePlaybook(FORMS_DATA,FORMS_HI),hi:FORMS_HI}]));const e=await kitBusiness({now:new Date('2026-10-29T10:00:00Z')},{idea:'Data entry service for client records'});
 const order=await e.call('venture.order.create',{clientId:e.client.id,offerId:e.offers[0].id,request:'Map and compare the supplied client records.',intake:{fields:{'record-id-column':'Record','site-url':'https://records.example.com/form','data-consent':true}},intakeFiles:{'source-file':{name:'records.csv',contentBase64:Buffer.from('Record,Customer\nA001,Asha').toString('base64')},'permission-file':{name:'permission.txt',contentBase64:Buffer.from('Written permission for the fixture client.').toString('base64')}}});
 const file={id:order.intake.fields['source-file']};
 const entry=await e.call('venture.desk.act',{playbook:'data-entry-desk',kind:'entries',id:'new',action:'prepare',payload:{orderId:order.id,fileId:file.id,identityColumn:'Record',rowIndex:0}});
 // Synthetic current capture was owner inspected in the separately tested browser boundary.
 await ventureAction(e.deps,owner,'approve','test.capture',tx=>{const row=tx.find('venture-entry-record',entry.id)!;tx.replace({...row,pageHash:'fixture-page',mappingProposal:{pageHash:'fixture-page',sourceDigest:row.sourceDigest,mapping:[{column:'Customer',targetId:'name'}]}});});
 await assert.rejects(e.call('venture.delivery.run',{orderId:order.id}),{code:'RULE_UNCONFIRMED'});const previous=FORMS_ACCESS_RULE.confirmedBy;FORMS_ACCESS_RULE.confirmedBy={name:'Synthetic local test reviewer',on:'2026-10-29'};t.after(()=>{FORMS_ACCESS_RULE.confirmedBy=previous;});
 const previewsBefore=e.models.previewed.length;let run=await e.call('venture.delivery.run',{orderId:order.id});assert.equal(run.status,'waiting-for-you');
 run=await approveWaiting(e,run,{note:'Read current exact source artifact.',calls:[{tool:'forms.map',input:'{}'}],finished:true} as never);
 const source=formsRunSource(e.store.read(),listRecords(e.store.read(),'venture-record')[0].id,order.id),text=formArtifact(source.rows,'mapping');
 assert.equal(e.models.previewed.slice(previewsBefore).filter(task=>task.purpose==='agent-turn').length,1);assert.equal(e.models.previewed.slice(previewsBefore).filter(task=>task.purpose==='delivery').length,0,'code renders without another writer');assert.equal(run.status,'ready-for-review');assert.equal(run.playbookChecks.find((r:any)=>r.check==='mapping-faithful').outcome,'pass');
 await assert.rejects(e.call('venture.delivery.review',{runId:run.id,verdict:'edited',editedText:'All records saved.'}),{code:'FORM_SOURCE_CHANGED'});
 await ventureAction(e.deps,owner,'approve','test.changed',tx=>{const row=tx.find('venture-upload',file.id)!;tx.replace({...row,contentBase64:Buffer.from('Record,Customer\nA001,Other').toString('base64')});});
 await assert.rejects(e.call('venture.delivery.review',{runId:run.id,verdict:'accepted'}),{code:'FORM_SOURCE_CHANGED'});
 await ventureAction(e.deps,owner,'approve','test.restore-source',tx=>{const row=tx.find('venture-upload',file.id)!;tx.replace({...row,contentBase64:Buffer.from('Record,Customer\nA001,Asha').toString('base64')});});
 const waiting=await e.call('venture.delivery.run',{orderId:order.id});let outbound=0;const original=e.deps.models.runPreview.bind(e.deps.models);
 e.deps.models.runPreview=async(_ctx,_id,_approved,_validate,options)=>{await ventureAction(e.deps,owner,'approve','test.change-before-send',tx=>{const source=tx.find('venture-upload',file.id)!;tx.replace({...source,contentBase64:Buffer.from('Record,Customer\nA001,Changed at transport').toString('base64')});});options?.beforeDispatch?.();outbound++;throw Object.assign(new Error('Fixture transport would have sent'),{code:'FORM_SOURCE_CHANGED'});};
 try{await assert.rejects(e.call('venture.delivery.approve',{runId:waiting.id,digest:waiting.preview.digest}),{code:'FORM_SOURCE_CHANGED'});assert.equal(outbound,0,'source revocation at the physical model boundary sends nothing');}finally{e.deps.models.runPreview=original;}

});
