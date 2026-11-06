import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {SeoStrategyWork} from '../../src/places/work/desks/SeoStrategyWork';
import {EngineProvider} from '../../src/engine/context';
import {TextProvider} from '../../src/text';
import {createFakeClient} from '../../src/engine/fake';
it('experiment creation binds selected checked work and a frozen panel without accepting made-up receipt fields',async()=>{
 const client=createFakeClient(),request=vi.fn(async(method:string,p:any)=>{
  if(method==='venture.desk.list')return {rows:p.kind==='work'?[{id:'checked',operation:'content',state:'approved',stale:false,result:{pass:true},checkedAt:'2026-10-28'}]:p.kind==='panel'?[{id:'panel',state:'approved',questionCount:15}]:[]};
  if(method==='venture.desk.act')return {id:'experiment',result:{state:'candidate'}};
  if(method==='venture.desk.get')return {item:{state:'candidate'},digest:'view'};
 });client.request=request as typeof client.request;
 render(<TextProvider language="en"><EngineProvider client={client}><SeoStrategyWork/></EngineProvider></TextProvider>);
 fireEvent.click(screen.getByText('Learn from a measured experiment'));
 fireEvent.change(await screen.findByLabelText('Checked article evidence'),{target:{value:'checked'}});
 fireEvent.change(screen.getByLabelText('Frozen answer panel'),{target:{value:'panel'}});
 fireEvent.click(screen.getByRole('button',{name:'Start this experiment'}));
 expect(request).toHaveBeenCalledWith('venture.desk.act',{playbook:'seo-visibility',kind:'strategy',id:'new',action:'create',payload:{workId:'checked',panelId:'panel'}});
 expect((await screen.findByRole('status')).textContent).toBe('Candidate saved. Complete the publication and observation evidence before learning from it.');
});
