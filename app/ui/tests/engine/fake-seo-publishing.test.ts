import {it,expect} from 'vitest';
import {fakeSeoPublishingKinds} from '../../src/engine/fake-seo-publishing';
import type {W4DeskHost} from '../../src/engine/fake-w4';
function fixture(){
 let text='Checked client article.',offer='content-retainer';const host={current:()=> 'business',now:()=> '2026-10-28T12:00:00.000Z',emit:()=>{},digest:JSON.stringify,socialClientAnswer:()=>({answer:{decision:'approved'},packDigest:JSON.stringify('Checked client article.')}),ask:(method:string)=>{
  if(method==='venture.delivery.list')return [{id:'run',orderId:'order',status:'accepted',practice:false,deliverable:{title:'Client article'},renderedText:text,checks:[],playbookChecks:[]}];
  if(method==='venture.order.list')return [{id:'order',offerId:'offer',intake:{fields:{siteUrl:'https://client.example/'}}}];
  if(method==='venture.blueprint.get')return {playbook:{id:'seo-visibility'},blueprint:{offers:[{id:'offer',playbookOffer:offer}]}};
  throw Error('Unexpected host method '+method);
 }} as unknown as W4DeskHost;return {kinds:fakeSeoPublishingKinds(host),change:()=>{text='Changed words.';},edgeOffer:()=>{offer='fix-and-measure';}};
}
it('demo uses current plan and current client text, returns exact previews and never invents a live publication',()=>{
 const f=fixture(),desk=f.kinds.publishing!,base={playbook:'seo-visibility',kind:'publishing'};
 desk.act!({...base,id:'connection',action:'configure',payload:{url:'https://client.example/',username:'owner',password:'sample'}});
 const view=desk.get!({...base,id:'run'}) as any;expect(view.item.content).toContain('data-chausar-article');
 expect(()=>desk.act!({...base,id:'run',action:'send',digest:'old',payload:{}})).toThrowError(expect.objectContaining({code:'APPROVAL_STALE'}));
 const sent=desk.act!({...base,id:'run',action:'send',digest:view.digest,payload:{}}) as any;expect(sent.result.outcome).toBe('not-sent');expect((desk.get!({...base,id:sent.id}) as any).item.acceptance).toBe(null);
 f.change();expect(()=>desk.get!({...base,id:'run'})).toThrowError(expect.objectContaining({code:'SEO_CLIENT_APPROVAL_REQUIRED'}));
});
it('demo checks fix-and-measure edge scope and exact replacement before it reports missing remote evidence',()=>{
 const f=fixture();f.edgeOffer();const desk=f.kinds.edge!,base={playbook:'seo-visibility',kind:'edge'};
 desk.act!({...base,id:'connection',action:'configure',payload:{siteUrl:'https://client.example/',accountId:'a'.repeat(32),namespaceId:'b'.repeat(32),token:'sample'}});
 const input={...base,id:'new',action:'stage',payload:{runId:'run',path:'page/title',after:'Checked client article.',summary:'Fix title'}};
 expect(()=>desk.act!({...input,payload:{...input.payload,after:'Unapproved words.'}})).toThrowError(expect.objectContaining({code:'SEO_CLIENT_APPROVAL_REQUIRED'}));
 expect(()=>desk.act!({...input,payload:{...input.payload,path:'../escape'}})).toThrowError(expect.objectContaining({code:'SITE_PATH_INVALID'}));
 expect(()=>desk.act!(input)).toThrowError(expect.objectContaining({code:'EDGE_READ_FAILED'}));
 expect(()=>desk.act!({...input,digest:'not-allowed'})).toThrowError(expect.objectContaining({code:'SEO_DRAFT_REQUIRED'}));
});
