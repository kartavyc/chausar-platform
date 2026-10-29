import {afterEach,expect,it} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {App} from '../../src/shell/App';
import {FakeEngine,createFakeClient} from '../../src/engine/fake';
import {priceAndAcceptPlan} from '../helpers/accepted-plan';
const en='Lead generation and appointment setting',hi='संभावित क्लाइंट खोजना और मुलाकात तय करना';
afterEach(()=>{cleanup();window.location.hash='';});
async function mount(language:'en'|'hi',custom?:string){
 const client=createFakeClient(new FakeEngine({fresh:true}));
 await client.request('workspace.create',{name:'Fictional label review',pack:'services'});
 await client.request('venture.create',{idea:'lead generation',countryCode:'IN'});
 for(const [questionId,answer] of [['q_1',{skipped:true}],['q_pricing_model',{choiceId:'monthly'}],['q_price',{skipped:true}],['q_tax',{yes:false}]] as const)await client.request('venture.interview.answer',{questionId,answer});
 const plan=await client.request('venture.blueprint.draft',{useTemplate:true});
 expect(plan.playbook?.id).toBe('lead-generation');await priceAndAcceptPlan(client,plan,'2500');
 if(custom){const real=client.request.bind(client);client.request=(async(method:Parameters<typeof real>[0],params:unknown)=>{const value=await real(method,params as never);return (method==='venture.get'||method==='venture.blueprint.get')&&value&&typeof value==='object'?{...value,playbook:{id:'lead-generation',label:custom}}:value;}) as typeof client.request;}
 window.location.hash='#/work?state=orders';render(<App client={client} language={language}/>);
 await waitFor(()=>expect(document.querySelector('[data-desk="lead-generation"]')).toBeTruthy());
}
for(const [name,language,custom,label] of [['Hindi','hi',undefined,hi],['English','en',undefined,en],['custom owner label','hi','My custom lead practice','My custom lead practice']] as const){
 it('preserves the correct '+name+' label in actual Work, business menu and plan',async()=>{
  await mount(language,custom);
  const desk=document.querySelector('[data-desk="lead-generation"]') as HTMLElement;
  expect(within(desk).getByText(label)).toBeTruthy();
  expect(screen.getByRole('button',{name:/My service business/}).textContent).toContain(label);
  await act(async()=>{window.location.hash='#/business/plan';fireEvent(window,new HashChangeEvent('hashchange'));});
  await waitFor(()=>expect(screen.getByRole('main').textContent).toContain(label));
 });
}
