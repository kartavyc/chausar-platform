// Exact type approvals and immutable pricing provenance, original Chausar behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import {extractTenderQuestions} from '../runtime/venture/playbooks/tender-desk/questions.ts';
import {prepareTenderRows,changeTenderAnswer,changeTenderType,changeTenderControls,tenderTypeDigest,approveTenderType,tenderApproved} from '../runtime/venture/playbooks/tender-desk/state.ts';

const rows=()=>prepareTenderRows({orderId:'order_1',clientId:'client_1',sourceDigest:'source-v1',selection:{rfpFileId:null,documentFileIds:['upload_1'],issuerFileId:null,mapping:null},questions:extractTenderQuestions('Describe the company.\nDescribe the API.\nState the price.','rfp')});
test('type approval binds exact answers, controls, classification and source provenance',()=>{
 let data=rows();
 data=data.map(row=>changeTenderAnswer(row,row.question.ownerOnly?'INR 100':'We provide services.','owner'));
 const signed=approveTenderType(data,'narrative',tenderTypeDigest(data,'narrative'),()=>true);
 assert.equal(tenderApproved(signed[0]),true);assert.equal(tenderApproved(signed[1]),false);
 assert.equal(tenderApproved(changeTenderAnswer(signed[0],'Different words.','owner')),false);
 assert.equal(tenderApproved(changeTenderType(signed[0],'technical')),false);
 assert.equal(tenderApproved(changeTenderControls(signed[0],{lengthWords:50,tone:'formal'})),false);
 assert.equal(tenderApproved({...signed[0],sourceDigest:'source-v2'}),false);
 assert.throws(()=>approveTenderType(data,'narrative','old',()=>true),{code:'APPROVAL_CHANGED'});
 assert.throws(()=>approveTenderType(data,'narrative',tenderTypeDigest(data,'narrative'),()=>false),{code:'TENDER_GROUNDING_REQUIRED'});
});
test('pricing can never be imported as agent words, even after owner reclassification',()=>{
 const price=changeTenderType(rows()[2],'narrative');
 assert.throws(()=>changeTenderAnswer(price,'INR 100','agent'),{code:'PRICING_OWNER_ONLY'});
 const saved=changeTenderAnswer(price,'INR 100','owner');
 assert.equal(saved.question.authoredBy,'owner');
});
test('type approval refuses unanswered and over-limit rows without partial approval',()=>{
 const data=rows();
 assert.throws(()=>approveTenderType(data,'narrative',tenderTypeDigest(data,'narrative'),()=>true),{code:'TENDER_ANSWER_REQUIRED'});
 const saved=changeTenderAnswer(changeTenderControls(data[0],{lengthWords:20,tone:'formal'}),Array(21).fill('word').join(' '),'owner');
 assert.throws(()=>approveTenderType([saved],'narrative',tenderTypeDigest([saved],'narrative'),()=>true),{code:'TENDER_LENGTH_EXCEEDED'});
 assert.equal(saved.approval,null);
});
