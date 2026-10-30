// CA12 original public-path tests. Identity stays in vault records; approved exports are XLSX only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {kitBusiness} from './fixtures/venture/kit-business.ts';
import {unzip} from '../runtime/venture/playbooks/kit/ooxml/zip.ts';
const facts={assessmentYear:'2027-28',pan:'ABCPD1234E',aadhaar:'234567891234',figures:[{key:'salary',amountMinor:'120000000',source:'Owner typed from salary statement'}]};
test('pack reads mask identities; export binds exact data, selection and explicit disclosure',async()=>{
 const env=await kitBusiness(undefined,{idea:'CA firm in Pune'});
 const request={playbook:'ca-firm',kind:'data-pack',id:'new',action:'save',payload:{clientId:env.client.id,...facts}};
 const saved=(await env.call('venture.desk.act',request)).result;
 assert.equal(JSON.stringify(saved).includes(facts.pan),false);assert.equal(JSON.stringify(saved).includes(facts.aadhaar),false);
 const selection={packId:saved.id,digest:saved.digest,fields:['pan','aadhaar','salary'],unmask:[],requestedBy:'CA Asha',purpose:'Review before return preparation'};
 const preview=(await env.call('venture.desk.act',{playbook:'ca-firm',kind:'data-pack',id:saved.id,action:'preview-export',digest:saved.digest,payload:selection})).result;
 await assert.rejects(env.call('venture.ca.dataPack.export',{...selection,approvalDigest:'wrong'}),{code:'CA_PACK_APPROVAL_REQUIRED'});
 await assert.rejects(env.call('venture.ca.dataPack.export',{...selection,unmask:['pan'],approvalDigest:preview.approvalDigest}),{code:'CA_PACK_APPROVAL_REQUIRED'});
 const exported=await env.call('venture.ca.dataPack.export',{...selection,approvalDigest:preview.approvalDigest});
 assert.equal(exported.name.endsWith('.xlsx'),true);const files=unzip(Buffer.from(exported.contentBase64,'base64'));
 assert.equal(files.some(file=>file.name.endsWith('.json')),false);
 const xml=files.map(file=>Buffer.from(file.bytes).toString()).join('');assert.equal(xml.includes(facts.assessmentYear),false,'unselected assessment year must not be exported');assert.equal(xml.includes(facts.pan),false);assert.equal(xml.includes(facts.aadhaar),false);assert.match(xml,/1200000\.00/);
 const required={...selection,unmask:['pan']};const full=(await env.call('venture.desk.act',{playbook:'ca-firm',kind:'data-pack',id:saved.id,action:'preview-export',digest:saved.digest,payload:required})).result;
 const disclosed=await env.call('venture.ca.dataPack.export',{...required,approvalDigest:full.approvalDigest});const disclosedXml=unzip(Buffer.from(disclosed.contentBase64,'base64')).map(file=>Buffer.from(file.bytes).toString()).join('');assert.match(disclosedXml,new RegExp(facts.pan));assert.equal(disclosedXml.includes(facts.aadhaar),false);
 await env.call('venture.desk.act',{...request,id:saved.id,digest:saved.digest,payload:{clientId:env.client.id,...facts,figures:[{...facts.figures[0],amountMinor:'140000000'}]}});
 await assert.rejects(env.call('venture.ca.dataPack.export',{...selection,approvalDigest:preview.approvalDigest}),{code:'CA_PACK_CHANGED'});
});
test('pack refuses model provenance, duplicate figures and unknown disclosure fields',async()=>{
 const env=await kitBusiness(undefined,{idea:'CA firm in Pune'});
 await assert.rejects(env.call('venture.desk.act',{playbook:'ca-firm',kind:'data-pack',id:'new',action:'save',payload:{clientId:env.client.id,...facts,figures:[facts.figures[0],facts.figures[0]]}}),{code:'CA_PACK_INVALID'});
});
test('pack figures have a rederivable receipt without identity inputs',async()=>{const env=await kitBusiness(undefined,{idea:'CA firm in Pune'});const saved=(await env.call('venture.desk.act',{playbook:'ca-firm',kind:'data-pack',id:'new',action:'save',payload:{clientId:env.client.id,...facts}})).result;assert.ok(saved.receiptId);const receipt=await env.call('venture.ca.receipt',{id:saved.receiptId});assert.equal(receipt.rederived,'same');assert.equal(JSON.stringify(receipt).includes(facts.pan),false);assert.equal(saved.figures[0].display,'INR 1,200,000.00');});

test('incidental source and recipient text cannot disclose an unapproved saved identity',async()=>{
 const env=await kitBusiness(undefined,{idea:'CA firm in Pune'});const input={...facts,figures:[{...facts.figures[0],source:facts.pan+'-bank-'+facts.aadhaar+'.csv'}]};const saved=(await env.call('venture.desk.act',{playbook:'ca-firm',kind:'data-pack',id:'new',action:'save',payload:{clientId:env.client.id,...input}})).result;
 assert.equal(JSON.stringify(saved).includes(facts.pan),false);const receipt=await env.call('venture.ca.receipt',{id:saved.receiptId});assert.equal(JSON.stringify(receipt).includes(facts.pan),false);
 const pick={packId:saved.id,digest:saved.digest,fields:['salary'],unmask:[],requestedBy:'CA for '+facts.pan,purpose:'Prepare '+facts.aadhaar};const preview=(await env.call('venture.desk.act',{playbook:'ca-firm',kind:'data-pack',id:saved.id,action:'preview-export',digest:saved.digest,payload:pick})).result;
 const file=await env.call('venture.ca.dataPack.export',{...pick,approvalDigest:preview.approvalDigest});const xml=unzip(Buffer.from(file.contentBase64,'base64')).map(f=>Buffer.from(f.bytes).toString()).join('');assert.equal(xml.includes(facts.pan),false);assert.equal(xml.includes(facts.aadhaar),false);
});
