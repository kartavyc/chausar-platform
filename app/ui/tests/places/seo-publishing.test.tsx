import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {SeoPublishingWork} from '../../src/places/work/desks/SeoPublishingWork';
import {EngineProvider} from '../../src/engine/context';
import {TextProvider} from '../../src/text';
import {createFakeClient} from '../../src/engine/fake';
import {assertInkRules} from '../helpers/ink-rules';
it('sending a WordPress draft uses only the preview digest the owner just read',async()=>{
 const client=createFakeClient(),request=vi.fn(async(method:string,p:any)=>{
  if(method==='venture.delivery.list')return [{id:'draft',status:'accepted',practice:false,deliverable:{title:'Clinic article'}}];
  if(method==='venture.desk.list')return {rows:[]};
  if(method==='venture.desk.get')return {item:{runId:'draft',title:'Clinic article',content:'<p>Reviewed article</p>',site:'https://clinic.example/',status:'draft'},digest:'exact-view'};
  if(method==='venture.desk.act')return {id:'saved',result:{outcome:'applied'}};
 });client.request=request as typeof client.request;
 render(<TextProvider language="en"><EngineProvider client={client}><SeoPublishingWork/></EngineProvider></TextProvider>);
 fireEvent.click(screen.getByText('Send an approved article'));
 fireEvent.change((await screen.findAllByLabelText('Approved article'))[0]!,{target:{value:'draft'}});
 fireEvent.click(await screen.findByRole('button',{name:'Create this WordPress draft'}));
 expect(request).toHaveBeenCalledWith('venture.desk.act',expect.objectContaining({kind:'publishing',id:'draft',action:'send',digest:'exact-view',payload:{}}));
 expect(await screen.findByText('Draft saved. Review and publish it in WordPress.')).toBeTruthy();assertInkRules();
});
