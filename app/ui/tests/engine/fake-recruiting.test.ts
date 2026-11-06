import {it,expect,vi} from 'vitest';
import {FakeEngine} from '../../src/engine/fake';
const answers={roleTitle:'SQL analyst',location:'Pune',payRange:'Client to confirm',hardRules:['SQL reporting'],mustHaves:['Reports | Work sample'],exclusions:[],targetCompanies:[],searchWords:['SQL'],privacyNoticeUrl:'https://client.example/privacy',retentionDays:'90'};
it('demo recruiting follows current rule approval, source quote and exact message consent before recording contact',async()=>{
 let now='2026-10-28T10:00:00.000Z';const e=new FakeEngine({now:()=>now});vi.spyOn(e as any,'ventureView').mockReturnValue({venture:{launchStage:'rehearsal'}});const orders=await e.request('venture.order.list',{}) as any[];orders.sort((a,b)=>Number(b.id==='o-boat-12')-Number(a.id==='o-boat-12'));
 const act=(kind:string,id:string,action:string,payload:unknown,digest?:string)=>e.request('venture.desk.act',{playbook:'recruiting-desk',kind,id,action,payload,...(digest?{digest}:{})}) as Promise<any>;
 const get=(kind:string,id:string)=>e.request('venture.desk.get',{playbook:'recruiting-desk',kind,id}) as Promise<any>;
 const role=await act('role','new','create',{serviceOrderId:orders[0].id});
 for(const [questionId,value]of Object.entries(answers))await act('role',role.id,'answer',{questionId,value});
 let r=await get('role',role.id);await expect(act('candidate','new','add',{roleId:role.id,name:'Dev',email:null,resume:'SQL reports',sourceUrl:null})).rejects.toMatchObject({code:'RECRUIT_RULES_REQUIRED'});
 for(const criterion of r.item.brief.criteria){await act('role',role.id,'approve-rule',{criterionId:criterion.id},r.digest);r=await get('role',role.id);}
 const candidate=await act('candidate','new','add',{roleId:role.id,name:'Dev',email:'dev@example.com',resume:'SQL reports\nWork: 2020-01 to 2022-12: Analyst\nAge: 27',sourceUrl:null});
 const c=await get('candidate',candidate.id);expect(c.item.experienceMonths).toBe(36);expect(c.item.resume).not.toContain('Age');
 await act('candidate',candidate.id,'screen',{excerpts:[{id:'e',text:'SQL reports'}],findings:[{criterionId:'rule-1',status:'met',excerptId:'e'},{criterionId:'skill-1',status:'not_met',excerptId:null}]});expect((await get('candidate',candidate.id)).item.findings[1].status).toBe('unknown');
 await expect(act('touch','new','draft',{candidateId:candidate.id,kind:'first-message',text:'Hello'})).rejects.toMatchObject({code:'RECRUIT_PRIVACY_LINE_REQUIRED'});
 const touch=await act('touch','new','draft',{candidateId:candidate.id,kind:'first-message',text:'Hello. Privacy: https://client.example/privacy'});let t=await get('touch',touch.id);
 await expect(act('touch',touch.id,'record-sent',{evidenceRef:'sent'},t.digest)).rejects.toMatchObject({code:'RECRUIT_APPROVAL_REQUIRED'});
 await act('touch',touch.id,'approve',{},t.digest);t=await get('touch',touch.id);await act('touch',touch.id,'record-sent',{evidenceRef:'owner mailbox'},t.digest);
 expect((await get('candidate',candidate.id)).item.stage).toBe('contacted');
 const report=await act('role',role.id,'report',{});expect(report.line).toBe('Report from saved ledger evidence only.');expect(report.result.data.tiles.greeted).toBe(1);expect(report.result.receipt.digest).toBeTruthy();
 const reply=await act('touch','new','draft',{candidateId:candidate.id,kind:'reply',text:'Please share a work sample.'});const batch=await act('role',role.id,'batch-preview',{touchIds:[reply.id]});await act('role',role.id,'batch-approve',{touchIds:[reply.id]},batch.result.digest);await expect(act('role',role.id,'batch-approve',{touchIds:[reply.id]},batch.result.digest)).rejects.toMatchObject({code:'RECRUIT_APPROVAL_REQUIRED'});
 expect(batch.line).toBe('This batch approval covers only these exact messages in this round. Nothing was sent.');
 await e.request('venture.leads.block',{value:'dev@example.com'});await expect(act('touch',reply.id,'record-sent',{evidenceRef:'sent'},(await get('touch',reply.id)).digest)).rejects.toMatchObject({code:'OUTREACH_BLOCKED'});
 const previewRun=(await e.request('venture.delivery.list',{}) as any[]).find(r=>r.orderId===orders[0].id&&r.id==='d-ep12-script');expect(previewRun).toBeTruthy();
 let rr=await get('role',role.id);await act('role',role.id,'close',{},rr.digest);now='2027-02-01T10:00:00.000Z';const expiry=await act('role',role.id,'retention-preview',{});expect(expiry.line).toBe('Review these expired records before deleting them.');
 const reportCopy=await e.request('venture.report.render',{runId:previewRun.id,formats:['html']}) as any;await expect(act('role',role.id,'retention-delete',{},expiry.result.digest)).rejects.toMatchObject({code:'APPROVAL_CHANGED'});const changedExpiry=await act('role',role.id,'retention-preview',{});await act('role',role.id,'retention-delete',{},changedExpiry.result.digest);expect((await e.request('venture.report.list',{orderId:orders[0].id}) as any).reports).toEqual([]);expect((await e.request('venture.delivery.list',{}) as any[]).filter(r=>r.orderId===orders[0].id).every(r=>r.status==='stopped'&&r.renderedText===null)).toBe(true);

});
