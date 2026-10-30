// The generic run can describe only the exact approved desk pack, not independently rewrite tender answers.
import test from 'node:test';import assert from 'node:assert/strict';
import {tenderDelivery,tenderChecks} from '../runtime/venture/playbooks/tender-desk/checks.ts';
import {prepareTenderRows,changeTenderAnswer,approveTenderType,tenderTypeDigest} from '../runtime/venture/playbooks/tender-desk/state.ts';
import {extractTenderQuestions} from '../runtime/venture/playbooks/tender-desk/questions.ts';
const rows=()=>{let rows=prepareTenderRows({orderId:'order',clientId:'client',sourceDigest:'source',selection:{rfpFileId:null,issuerFileId:null,documentFileIds:['doc'],mapping:null},questions:extractTenderQuestions('Describe support.','rfp')});rows=rows.map(row=>changeTenderAnswer(row,'We provide support.','owner'));return approveTenderType(rows,'narrative',tenderTypeDigest(rows,'narrative'),()=>true);};
test('final tender report needs current exact row evidence and refuses extra model claims',()=>{
 const data=rows(),deliverable=tenderDelivery(data),toolCalls=[{tool:'tender.ground',envelope:{ok:true,result:{rows:data,delivery:deliverable}}}];
 assert.equal(tenderChecks({deliverable,toolCalls,tenderRows:data})[0].outcome,'pass');
 assert.equal(tenderChecks({deliverable:{...deliverable,title:'Guaranteed bid win'},toolCalls,tenderRows:data})[0].outcome,'fail');
 assert.equal(tenderChecks({deliverable,toolCalls,tenderRows:[]})[0].outcome,'fail');
 assert.equal(tenderChecks({deliverable,toolCalls:[],tenderRows:data})[0].outcome,'fail');
 assert.throws(()=>tenderDelivery(data.map(row=>({...row,approval:null}))),{code:'TENDER_APPROVAL_REQUIRED'});
});
