import {it,expect} from 'vitest';import {FakeEngine,createFakeClient} from '../../src/engine/fake';
it('public rehearsal onboards the developer kit, reviews exact source and accepts only its code report',async()=>{
 const client=createFakeClient(new FakeEngine({fresh:true,now:()=> '2026-10-29T10:00:00.000Z'}));
 await client.request('workspace.create',{name:'Developer practice',pack:'services'});await client.request('venture.create',{idea:'code review service',countryCode:'IN'});
 for(const [questionId,answer]of [['q_1',{skipped:true}],['q_pricing_model',{choiceId:'project'}],['q_price',{skipped:true}],['q_tax',{yes:false}]] as const)await client.request('venture.interview.answer',{questionId,answer});
 const plan=await client.request('venture.blueprint.draft',{useTemplate:true}),offer=plan.blueprint.offers.find(o=>o.playbookOffer==='qa-service')!;
 const priced=await client.request('venture.blueprint.update',{patch:{offers:plan.blueprint.offers.map(o=>({id:o.id,unitPrice:'2500'}))}});const planRow=(await client.request('venture.queue.list',{scope:'current'})).rows.find(r=>r.viewRef?.kind==='plan'&&r.viewRef.id===priced.blueprint.id)!;await client.request('venture.queue.decide',{id:planRow.id,digest:planRow.digest,action:'approve',viewed:true});
 const rules=await client.request('venture.rules.list',{});expect(rules.rules.length).toBeGreaterThan(0);expect(rules.rules.some(r=>r.line.includes('lawyer has not confirmed'))).toBe(true);
 const person=await client.request('venture.client.add',{name:'Fictional source owner',countryCode:'IN'}),source=JSON.stringify({repository:'client/shop',revision:'a'.repeat(40),files:[{path:'app.ts',content:'export const enabled = true;'}]});
 const order=await client.request('venture.order.create',{clientId:person.id,offerId:offer.id,request:'Review the copied source',intake:{fields:{startedAt:'2026-10-20',private:false}},intakeFiles:{source:{name:'source.txt',contentBase64:btoa(source)}}});
 await expect(client.request('venture.delivery.run',{orderId:order.id})).rejects.toMatchObject({code:'DEV_PROJECT_NOT_FOUND'});
 const file=(await client.request('venture.files.list',{orderId:order.id}))[0]!,base={playbook:'dev-agency' as const,kind:'project'},made=await client.request('venture.desk.act',{...base,id:order.id,action:'prepare',payload:{fileId:file.id,startedAt:'2026-10-20T00:00:00.000Z'}});
 const act=async(action:string,payload:Record<string,unknown>)=>client.request('venture.desk.act',{...base,id:made.id,action,payload,digest:(await client.request('venture.desk.get',{...base,id:made.id})).digest});
 await act('read',{path:'app.ts',first:1,last:1});await act('confirm-review',{confirmed:true});const run=await client.request('venture.delivery.run',{orderId:order.id});expect(run.canAccept).toBe(true);expect(run.renderedText).toContain('Verdict: Ship');
 await expect(client.request('venture.delivery.review',{runId:run.id,verdict:'edited',editedText:'All production systems are safe.'})).rejects.toMatchObject({code:'DERIVED_STALE'});
 await act('findings',{findings:[]});await expect(client.request('venture.delivery.review',{runId:run.id,verdict:'accepted'})).rejects.toMatchObject({code:'DEV_REVIEW_REQUIRED'});
});
