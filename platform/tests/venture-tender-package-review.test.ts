// Independent whole-package boundary review. No provider calls or implementation edits.
import test from 'node:test';
import assert from 'node:assert/strict';
import {owner} from './venture-views-env.ts';
import {kitBusiness} from './fixtures/venture/kit-business.ts';
import {ventureAction,listRecords,digest} from '../runtime/venture/records.ts';
import {net,personNamed} from './venture-network-env.ts';
import {tenderTask} from '../runtime/venture/playbooks/tender-desk/ai-core.ts';
import {extractTenderQuestions} from '../runtime/venture/playbooks/tender-desk/questions.ts';
import {groundTenderCommercial} from '../runtime/venture/playbooks/tender-desk/ground.ts';
import {tenderMoneyReceipts} from '../runtime/venture/playbooks/tender-desk/money.ts';

test('Forget removes client-linked tender sources even before question import',async()=>{
 const env=await kitBusiness({now:new Date('2026-10-29T12:00:00Z')},{idea:'A tender response business in Pune'});
 const offer=env.offers.find(row=>row.playbookOffer==='bid-response')!;
 const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:offer.id,request:'Prepare a client tender.',intake:{fields:{rfpText:'Describe support.',deadline:'2026-11-15',portal:'CPPP',documents:['evidence.csv'],private:true}}});
 const upload=await ventureAction(env.deps,owner,'prepare','review.tender-source',tx=>{
  tx.replace({...tx.find('venture-order',order.id)!,intake:{rights:null,format:'long',aiVoice:false,aiPresenter:false,paidPromotion:false,cutFile:null,fields:{rfpText:'Describe support.',private:true,portal:'CPPP'}}});
  const text='Opaque client confidential source';return tx.put({...tx.base('venture-upload'),name:'evidence.csv',format:'csv',bytes:text.length,digest:digest(text),contentBase64:Buffer.from(text).toString('base64'),scope:{kind:'order',orderId:order.id},clientData:true});
 });
 await net(env as any,'venture.network.import',{kind:'contacts-csv',name:'contacts.csv',text:'Name,E-mail 1 - Value\nAsha Rao,asha@example.com'});
 const person=personNamed(env as any,'Asha Rao');
 await ventureAction(env.deps,owner,'prepare','review.client-link',tx=>{tx.replace({...tx.find('venture-person',person.id)!,clientId:order.clientId});});
 await net(env as any,'venture.network.forget',{id:person.id});
 assert.equal(listRecords(env.store.read(),'venture-upload').some(row=>row.id===upload.id),false);
 assert.equal(listRecords(env.store.read(),'venture-order').find(row=>row.id===order.id)?.intake,undefined);
});

test('a narrative model answer cannot write commercial pricing from source facts',()=>{
 const question=extractTenderQuestions('Describe support.','rfp')[0]!;
 const task=tenderTask(question,{lengthWords:100,tone:'professional'},[{id:'client',text:'We provide support. Our price is INR 5000.'}]);
 assert.throws(()=>task.validate({answer:'We provide support. Our price is INR 5000.'}),{code:'PRICING_OWNER_ONLY'});
 const priced='Support is INR 5000 per month.';
 assert.throws(()=>tenderTask(question,{lengthWords:100,tone:'professional'},[{id:'client',text:priced}]).validate({answer:priced}),{code:'PRICING_OWNER_ONLY'});
});

test('alternate explicit currency syntax cannot evade exact currency receipt evidence',()=>{
 for(const answer of ['The fee is 9000 INR.','The fee is CAD 9000.','The fee is 9000 rupees.','The fee is inr 9000.','The fee is 9000 Rupees.']){
  assert.equal(groundTenderCommercial(answer,[{id:'quote',text:'The fee is USD 9000.'}]).passed,false,answer);
 }
});

test('commercial output detection preserves the offered thousand-word answer limit',()=>{
 const question=extractTenderQuestions('Describe support.','rfp')[0]!;
 const answer=Array(900).fill('support').join(' ');
 const task=tenderTask(question,{lengthWords:1000,tone:'professional'},[{id:'client',text:'We provide support.'}]);
 assert.equal(task.validate({answer}).answer,answer);
});

test('Indian amount multipliers cannot produce a partial-number receipt',()=>{
 const answer='The fee is INR 1.2 Lakh.';
 const result=tenderMoneyReceipts(answer,[{id:'quote',text:answer}]);
 assert.ok(result.unmatched.length>0||result.receipts[0]?.minor==='12000000',JSON.stringify(result));
 const malformed='The fee is INR 1,2345.';
 const partial=tenderMoneyReceipts(malformed,[{id:'quote',text:malformed}]);
 assert.ok(partial.unmatched.length>0||partial.receipts[0]?.minor==='1234500',JSON.stringify(partial));
});
