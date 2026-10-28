// Original Chausar social canvas interaction tests.
import { expect,it,vi } from 'vitest';
import { fireEvent,render,screen } from '@testing-library/react';
import { SocialCanvas } from '../../src/places/work/desks/SocialCanvas';
import { EngineError } from '../../src/engine/types';
import { TextProvider } from '../../src/text';
import { EngineProvider } from '../../src/engine/context';
import { createFakeClient,FakeEngine } from '../../src/engine/fake';
const item={id:'order1',orderId:'order1',request:'Weekly posts',runId:'run1',inventory:{counts:{claims:2,numbers:1,stories:1,mistakes:0,quotes:0,total:4},items:[]},sourceProblem:null,cards:[{channel:'linkedin',format:'text',ready:true,trace:['text-supported','single-post'],posts:[{id:'run1.post-1',runId:'run1',channel:'linkedin',text:'We teach yoga.'}]},{channel:'instagram',format:'image-brief',ready:false,trace:['channel-needs-media','source-image-missing'],posts:[]},{channel:'x',format:'thread',ready:true,trace:['text-supported','bounded-thread-split'],posts:[]}]};
function start(language:'en'|'hi'='en',paid=false,rows=[item],failure=''){
 const client=createFakeClient(new FakeEngine());
 const request=vi.fn(async(method:string,p:any)=>{
  if(method==='venture.order.list')return [{id:'order1',request:'Weekly posts',status:'open'}];
  if(method==='venture.desk.list')return {playbook:'social-agency',kind:'canvas',rows,line:''};
  if(method==='venture.desk.get')return {playbook:'social-agency',kind:p.kind,item:p.kind==='canvas'?item:{id:'run1.post-1',runId:'run1',postId:'run1.post-1',text:'We teach yoga.',roundsUsed:0,quote:null},digest:'shown'};
  if(method==='venture.desk.act'&&failure)throw new EngineError(failure,'Engine detail');
  if(method==='venture.desk.act')return {playbook:'social-agency',kind:'revision',id:p.id,result:p.action==='quote'&&paid?{round:3,amountMinor:'25000',currency:'INR',display:'₹250.00',digest:'quote-shown',receiptId:'fig:revision:order1:post-1:3:25000:INR'}:null,line:''};
  return null;
 });client.request=request as typeof client.request;
 render(<TextProvider language={language}><EngineProvider client={client}><SocialCanvas /></EngineProvider></TextProvider>);return request;
}
it('shows channel cards, source counts and honest format traces, then refines only the selected post',async()=>{
 const request=start();
 expect(await screen.findByRole('heading',{name:'LinkedIn'})).not.toBeNull();
 expect(screen.getByText('Claims')).not.toBeNull();
 expect(screen.getByText('Image brief')).not.toBeNull();
 expect(screen.getByText('Add an image before publishing.')).not.toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Refine just this one'}));
 fireEvent.change(await screen.findByLabelText('What should change?'),{target:{value:'Make the opening warmer.'}});
 fireEvent.click(screen.getByRole('button',{name:'Preview this revision'}));
 await screen.findByText('The revision waits for your approval in Today.');
 expect(request.mock.calls.some(([method,p])=>method==='venture.desk.act'&&p.kind==='revision'&&p.action==='revise'&&p.payload.postId==='run1.post-1'&&p.payload.words==='Make the opening warmer.')).toBe(true);
});
it('shows Hindi canvas controls',async()=>{
 start('hi');expect(await screen.findByRole('button',{name:'केवल इसे सुधारें'})).not.toBeNull();expect(screen.getByText('दावे')).not.toBeNull();
});

it('shows the exact extra price and waits for a separate approval of that quote',async()=>{
 const request=start('en',true);
 fireEvent.click(await screen.findByRole('button',{name:'Refine just this one'}));
 fireEvent.change(await screen.findByLabelText('What should change?'),{target:{value:'A clearer opening.'}});
 fireEvent.click(screen.getByRole('button',{name:'Preview this revision'}));
 expect(await screen.findByText('₹250.00')).not.toBeNull();
 expect(screen.getByRole('button',{name:/Receipt for/}).getAttribute('data-receipt')).toBe('fig:revision:order1:post-1:3:25000:INR');
 expect(request.mock.calls.some(([method,p])=>method==='venture.desk.act'&&p.action==='revise')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Approve this extra round'}));
 await screen.findByText('The revision waits for your approval in Today.');
 expect(request.mock.calls.some(([method,p])=>method==='venture.desk.act'&&p.action==='revise'&&p.payload.quoteDigest==='quote-shown')).toBe(true);
});

it('opens the exact order linked from a revision reminder',async()=>{
 window.location.hash='#/work?socialOrder=order2';
 try {
  start('en',false,[item,{...item,id:'order2',orderId:'order2',request:'Linked monthly order',cards:[]}]);
  const select=await screen.findByRole('combobox',{name:'Order'});
  expect((select as HTMLSelectElement).value).toBe('order2');
  expect(screen.queryByText('We teach yoga.')).toBeNull();
 } finally {window.location.hash='';}
});

it('shows the validated goal and reader action beside its post',async()=>{
 const row={...item,cards:[{...item.cards[0]!,posts:[{...item.cards[0]!.posts[0]!,plan:{kind:'value',goals:['Teach one idea'],actions:['Try it'],hookFormula:'Question'}}]}]};
 start('en',false,[row]);
 expect(await screen.findByText('Teach one idea')).not.toBeNull();
 expect(screen.getByText('Try it')).not.toBeNull();
 expect(screen.getByText('Value')).not.toBeNull();
});

it('explains when an extra-round price must be set before requesting another revision',async()=>{
 start('en',false,[item],'OFFER_EXTRA_ROUND');
 fireEvent.click(await screen.findByRole('button',{name:'Refine just this one'}));
 fireEvent.change(await screen.findByLabelText('What should change?'),{target:{value:'Another revision.'}});
 fireEvent.click(screen.getByRole('button',{name:'Preview this revision'}));
 expect((await screen.findByRole('alert')).textContent).toBe('Set your extra-round price, then review its quote before approving.');
});
