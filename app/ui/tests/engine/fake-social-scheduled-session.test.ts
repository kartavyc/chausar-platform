// Actual fake engine session boundaries, with a local approved draft fixture.
import {it,expect,vi} from 'vitest';
import {FakeEngine} from '../../src/engine/fake';
const base={playbook:'social-agency',kind:'scheduled'};
async function fixture(){
 let now='2026-10-27T12:00:00.000Z';const engine=new FakeEngine({now:()=>now});
 const internal=engine as unknown as {answerNow(method:string,p:Record<string,unknown>):unknown};const original=internal.answerNow.bind(engine);
 vi.spyOn(internal,'answerNow').mockImplementation((method,p)=>method==='venture.share.list'?{links:[{answer:{decision:'approved'}}],posts:[{draftId:'draft_local.post-1',connectorId:'x',name:'X',channel:'x',text:'Asha can join our workshop.'}]}:original(method,p));
 const proposed:any=await engine.request('venture.posting.propose',{draftId:'draft_local.post-1'});
 const made:any=await engine.request('venture.desk.act',{...base,id:'new',action:'create',payload:{postId:proposed.postId,connectorId:'x',dueAt:'2026-10-27T12:05:00.000Z'}});
 const get=()=>engine.request('venture.desk.get',{...base,id:made.id}) as Promise<any>;const view=await get();await engine.request('venture.desk.act',{...base,id:made.id,action:'approve',payload:{},digest:view.digest});
 return {engine,get,due:()=>{now='2026-10-27T12:05:00.000Z';}};
}
it('actual workspace lock and reopen loses the exact fake posting authority',async()=>{const env=await fixture();await env.engine.request('workspace.lock');await env.engine.request('workspace.open',{folder:'lumen'});env.due();expect((await env.get()).item).toMatchObject({state:'blocked',reason:'This posting approval is no longer in this session. Review and approve a new slot again.'});});
it('the public fake desk executes the due slot once while the original session stays open',async()=>{const env=await fixture();env.due();expect((await env.get()).item.state).toBe('posted');expect((await env.get()).item.state).toBe('posted');});

it('public Forget removes a partial-name scheduled copy and its posting authority',async()=>{const env=await fixture();const person:any=await env.engine.request('venture.desk.act',{playbook:'lead-generation',kind:'source',id:'new',action:'manual',payload:{name:'Asha Rao',email:'asha@dewdrop.example',source:'referral'}});await env.engine.request('venture.network.forget',{id:person.result.personId});env.due();expect((await env.get()).item).toMatchObject({state:'cancelled',text:'',account:null,postId:null,approvedDigest:null});});
