// Independent 5O domain review. These regressions exercise the author's public domain functions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyTenderQuestion,extractTenderQuestions,reassignTenderQuestion,setTenderAnswer} from '../runtime/venture/playbooks/tender-desk/questions.ts';
import {loadTenderSources} from '../runtime/venture/playbooks/tender-desk/sources.ts';
import {writeXlsx} from '../runtime/venture/playbooks/kit/ooxml/xlsx.ts';
test('unit and hourly rates remain owner-only commercial answers after reclassification',()=>{
 for(const question of ['What is your hourly rate?','State the rate per unit.','What is the bid value?','प्रति घंटा दर बताएं।','प्रति इकाई दर बताएं।']){
  assert.equal(classifyTenderQuestion(question).kind,'commercial',question);
  const row=reassignTenderQuestion(extractTenderQuestions(question,'rfp')[0]!,'technical');
  assert.throws(()=>setTenderAnswer(row,'INR 100','agent'),{code:'PRICING_OWNER_ONLY'});
 }
});
function fixture(){
 const order={id:'order_review',clientId:'client_review',status:'open',intake:{fields:{rfpText:''}}};
 const rfp={id:'upload_rfp',name:'rfp.txt',format:'csv',scope:{kind:'order',orderId:order.id},contentBase64:Buffer.from('Do you hold ISO 9001 certification?').toString('base64'),digest:'metadata-is-not-proof'};
 const docs={...rfp,id:'upload_bucket',name:'copied-rfp.txt'};
 const rows=[rfp,docs],read={find:(kind:string,id:string)=>kind==='venture-order'&&id===order.id?order:kind==='venture-upload'?rows.find(row=>row.id===id):undefined} as any;
 return {order,rfp,docs,read,deps:{host:'test'} as any,selection:{rfpFileId:rfp.id,issuerFileId:null,mapping:null,documentFileIds:[docs.id]}};
}
test('the RFP cannot also be selected as its own source-of-truth evidence',async()=>{
 const f=fixture();f.selection.documentFileIds=[f.rfp.id];await assert.rejects(loadTenderSources(f.deps,f.read,f.order.id,f.selection),{code:'TENDER_SOURCE_REQUIRED'});
});
test('copying identical RFP bytes to a different upload does not turn the demand into evidence',async()=>{
 const f=fixture();await assert.rejects(loadTenderSources(f.deps,f.read,f.order.id,f.selection),{code:'TENDER_SOURCE_REQUIRED'});
});
test('equivalent accepted base64 spellings cannot turn the issuer workbook into evidence',async()=>{
 const f=fixture(),encoded=Buffer.from(writeXlsx({sheets:[{name:'Questions',rows:[['Question','Answer'],['Do you hold ISO 9001 certification?',null]]}]})).toString('base64');
 f.rfp.format=f.docs.format='xlsx';f.rfp.contentBase64=encoded;
 f.docs.contentBase64=encoded.endsWith('=')?encoded.replace(/=+$/,''):encoded+'=';
 assert.match(f.docs.contentBase64,/^[A-Za-z0-9+/]*={0,2}$/);
 assert.deepEqual(Buffer.from(f.docs.contentBase64,'base64'),Buffer.from(encoded,'base64'));
 const selected={...f.selection,mapping:{sheet:'Questions',questionColumn:'A',answerColumn:'B',firstRow:2,lastRow:2}};
 await assert.rejects(loadTenderSources(f.deps,f.read,f.order.id,selected),{code:'TENDER_SOURCE_REQUIRED'});
});
test('combined documentation respects the same one-million-character limit as grounding',async()=>{
 const f=fixture(),files=Array.from({length:6},(_,n)=>({...f.docs,id:'upload_doc_'+n,contentBase64:Buffer.from(('Document '+n+' ').padEnd(180000,'x')).toString('base64')}));
 f.selection.documentFileIds=files.map(file=>file.id);f.read.find=(kind:string,id:string)=>kind==='venture-order'?f.order:id===f.rfp.id?f.rfp:files.find(file=>file.id===id);
 await assert.rejects(loadTenderSources(f.deps,f.read,f.order.id,f.selection),{code:'TENDER_SOURCE_REQUIRED'});
});
test('a client change during an awaited PDF read cannot silently rebind returned evidence',async()=>{
 const f=fixture();f.docs.format='pdf';f.docs.contentBase64=Buffer.from('%PDF-review-source-client-race').toString('base64');
 f.deps.services={helper:{run:async()=>{f.order.clientId='client_changed';return {result:{pages:[{page:1,text:'We provide support.'}]}};}}};
 await assert.rejects(loadTenderSources(f.deps,f.read,f.order.id,f.selection),{code:'DERIVED_STALE'});
});
