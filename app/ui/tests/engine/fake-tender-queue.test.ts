import {priceAndAcceptPlan} from '../helpers/accepted-plan';
import {expect,it,vi} from 'vitest';
import {FakeEngine} from '../../src/engine/fake';
import {FakePlaybooksDesk} from '../../src/engine/fake-playbooks';
import type {QueueRow} from '../../src/engine/types';
it.each([false,true])('public Today shows source-bound tender gaps without exposing locked businesses (%s)',async(locked)=>{
 const engine=new FakeEngine({fresh:true,now:()=> '2026-10-29T12:00:00Z'});
 const workspace=await engine.request('workspace.create',{name:'Tender studio',pack:'services',...(locked?{passphrase:'a-long-test-passphrase'}:{})}) as {folder:string};await engine.request('venture.create',{idea:'tender response business',countryCode:'IN'});
 for(const [questionId,answer]of [['q_1',{skipped:true}],['q_pricing_model',{choiceId:'project'}],['q_price',{skipped:true}],['q_tax',{yes:false}]] as const)await engine.request('venture.interview.answer',{questionId,answer});
 const plan=await engine.request('venture.blueprint.draft',{useTemplate:true}) as any,offer=plan.blueprint.offers.find((o:any)=>o.playbookOffer==='bid-response');
 await priceAndAcceptPlan(engine,plan,'100');
 const client=await engine.request('venture.client.add',{name:'Studio',countryCode:'IN'}) as any;
 const order=await engine.request('venture.order.create',{clientId:client.id,offerId:offer.id,request:'Prepare a tender.',intake:{fields:{rfpText:'Describe encryption.',deadline:'2026-11-15',portal:'CPPP',documents:['company.csv'],private:false}}}) as any;
 await engine.request('venture.files.add',{orderId:order.id,name:'company.csv',contentBase64:btoa('We provide support.')});
 const files=await engine.request('venture.files.list',{orderId:order.id}) as any[];
 await engine.request('venture.desk.act',{playbook:'tender-desk',kind:'bid',id:order.id,action:'import',payload:{rfpFileId:null,documentFileIds:[files[0].id],issuerFileId:null,mapping:null}});
 const rows=async()=>((await engine.request('venture.queue.list',{scope:'current'}))as any).rows.filter((r:any)=>r.id.startsWith('tender-gap:'));
 const gaps=await rows();expect(gaps).toHaveLength(1);expect(gaps[0].line).toContain('encryption');expect(gaps[0].notice.link).toBe('#/work?tenderOrder='+order.id);
 expect(await engine.request('venture.queue.decide',{id:gaps[0].id,digest:gaps[0].digest,action:'open'})).toMatchObject({outcome:'refused',reason:'NOT_A_DECISION'});expect(await rows()).toHaveLength(1);
 await engine.request('workspace.lock',{});await engine.request('workspace.create',{name:'Other business',pack:'services'});expect(await rows()).toHaveLength(0);
 const all=await engine.request('venture.queue.list',{scope:'all'}) as {rows:QueueRow[]};expect(all.rows.filter(r=>r.id.startsWith('tender-gap:'))).toHaveLength(locked?0:1);
 await engine.request('workspace.open',{folder:workspace.folder,...(locked?{passphrase:'a-long-test-passphrase'}:{})});expect(await rows()).toHaveLength(1);
 if(locked){let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>entered=resolve),held=new Promise<void>(resolve=>release=resolve),original=FakePlaybooksDesk.prototype.tenderNotices;
  const spy=vi.spyOn(FakePlaybooksDesk.prototype,'tenderNotices').mockImplementationOnce(async function(this:FakePlaybooksDesk,scope){const result=await original.call(this,scope);entered();await held;return result;});
  try{const pending=engine.request('venture.queue.list',{scope:'all'}) as Promise<{rows:QueueRow[]}>;await started;await engine.request('workspace.lock',{});release();expect((await pending).rows.filter(r=>r.id.startsWith('tender-gap:'))).toHaveLength(0);}finally{release();spy.mockRestore();}
 }
});
