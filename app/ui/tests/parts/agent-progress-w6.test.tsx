import {it,expect,vi} from 'vitest';
import {act,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {EngineProvider} from '../../src/engine/context';
import {FakeEngine,createFakeClient} from '../../src/engine/fake';
import type {EngineClient} from '../../src/engine/types';
import {RunSheet} from '../../src/parts/RunSheet';
import {RunStopNote} from '../../src/parts/RunSheetControls';
import {AgentProgress} from '../../src/parts/AgentProgress';
import type {RunDetail} from '../../src/engine/types';
import {TextProvider} from '../../src/text';
import {ClockProvider} from '../../src/shell/clock';

it('the native progress fixture has no retired turn cap or fabricated usual duration',async()=>{
 const client=createFakeClient(new FakeEngine({agentProgress:true}));
 const run=await client.request('venture.runs.get',{runId:'31'});
 expect(run.agentProgress).toBeDefined();expect(run.scope).toBeUndefined();expect(run.usually).toBeUndefined();
 expect(run.progress).toBe('indeterminate');expect(run.steps).toEqual([]);
 render(<TextProvider language="en"><ClockProvider now={()=>new Date('2026-10-30T12:00:00Z')}><EngineProvider client={client}><RunSheet runId="31" onClose={()=>{}}/></EngineProvider></ClockProvider></TextProvider>);
 await screen.findByText('AI updates');
 expect(screen.queryByText('indeterminate')).toBeNull();
});

it('run updates refresh from run.step and raw model text stays explicitly unverified',async()=>{
 const engine=new FakeEngine(),client=createFakeClient(engine),base=client.request.bind(client);
 let text='I expect about INR 900 for this draft.',status='running';
 client.request=(async(method,params)=>{const answer=await base(method as never,params as never);return method==='venture.runs.get'?{...answer as object,agentProgress:{messages:[{id:'message_sample',text,label:'model-estimate'}],tools:[{id:'tool_sample',name:'mcp__chausar__read_order',status}],model:'Synthetic example'}}:answer;}) as EngineClient['request'];
 render(<TextProvider language="en"><ClockProvider now={()=>new Date('2026-10-30T12:00:00Z')}><EngineProvider client={client}><RunSheet runId="31" onClose={()=>{}}/></EngineProvider></ClockProvider></TextProvider>);
 fireEvent.click(await screen.findByText('AI updates'));const message=await screen.findByText(text);
 expect(message.closest('[data-content]')).toBeTruthy();const marked=message.closest('[data-estimate]') as HTMLElement;expect(marked).toBeTruthy();expect(within(marked).getByText(/model estimate/i)).toBeTruthy();expect(marked.querySelector('[data-receipt]')).toBeNull();
 expect(screen.getByText('Reading the order')).toBeTruthy();expect(screen.getByText('Running')).toBeTruthy();
 text='The drafted reply is ready for your review.';status='done';await act(async()=>engine.emit({type:'run.step',businessId:'lumen',runId:'31',at:'2026-10-30T12:00:00Z'}));
 await screen.findByText(text);expect(screen.queryByText('I expect about INR 900 for this draft.')).toBeNull();expect(screen.getByText('Done')).toBeTruthy();
});
it('the optional fake progress fixture identifies itself as synthetic',async()=>{
 const engine=new FakeEngine({agentProgress:true});const run=await engine.request('venture.runs.get',{runId:'31'}) as any;
 expect(run.agentProgress.messages[0].text).toContain('Synthetic example');expect(run.agentProgress.messages[0].label).toBe('model-estimate');
 const normal=await new FakeEngine().request('venture.runs.get',{runId:'31'}) as any;expect(normal.agentProgress).toBeUndefined();
});
it('a manual step shows exact quoted arguments and approves only its current digest',async()=>{
 const engine=new FakeEngine(),client=createFakeClient(engine),base=client.request.bind(client);
 let pending:any={digest:'approval_sample',request:{kind:'file-change',requestId:'request_sample',threadId:'thread_sample',turnId:'turn_sample',itemId:'tool_sample',name:'Write',arguments:{file_path:'draft.txt',content:'Exact suggested copy with 900 in it.'}}};
 const decide=vi.fn(async(_params:unknown)=>{pending=undefined;return {runId:'31',decision:'approve'};});
 client.request=(async(method,params)=>{
  if(method==='venture.agentApproval.decide')return decide(params);
  const answer=await base(method as never,params as never);return method==='venture.runs.get'?{...answer as object,agentProgress:{messages:[],tools:[],pendingApproval:pending}}:answer;
 }) as EngineClient['request'];
 render(<TextProvider language="en"><ClockProvider now={()=>new Date('2026-10-30T12:00:00Z')}><EngineProvider client={client}><RunSheet runId="31" onClose={()=>{}}/></EngineProvider></ClockProvider></TextProvider>);
 const approve=await screen.findByRole('button',{name:'Approve step'});const source=screen.getByText(/Exact suggested copy with 900 in it/);
 expect(source.closest('[data-content]')).toBeTruthy();expect(source.textContent).toContain('"file_path": "draft.txt"');
 expect(decide).not.toHaveBeenCalled();await act(async()=>fireEvent.click(approve));
 expect(decide).toHaveBeenCalledExactlyOnceWith({runId:'31',digest:'approval_sample',decision:'approve'});
 await waitFor(()=>expect(screen.queryByRole('button',{name:'Approve step'})).toBeNull());
});
it('the fake never treats a saved or invented request as a live native approval',async()=>{
 const engine=new FakeEngine();
 await expect(engine.request('venture.agentApproval.decide',{runId:'31',digest:'invented',decision:'approve'})).rejects.toMatchObject({code:'APPROVAL_STALE'});
 await expect(engine.request('venture.agentApproval.decide',{runId:'31',digest:'invented',decision:'approve',allowEverything:true})).rejects.toMatchObject({code:'INVALID_VENTURE_REQUEST'});
 const internal=engine as unknown as {answerNow:(method:string,params:Record<string,unknown>)=>unknown};
 expect(()=>internal.answerNow('venture.agentApproval.decide',{runId:'31',digest:'invented',decision:'approve'})).toThrowError(expect.objectContaining({code:'APP_APPROVAL_REQUIRED'}));
});
it('a stopped tool job with no checked checkpoint offers Run again instead of Resume',async()=>{
 const again=vi.fn(),resume=vi.fn(),run={runId:'31',agentProgress:{messages:[],tools:[],canResume:false},stop:{state:'stopped',line:'Start again with the current sources.'}} as unknown as RunDetail;
 render(<TextProvider language="en"><RunStopNote run={run} onResume={resume} onRunAgain={again}/></TextProvider>);
 fireEvent.click(screen.getByRole('button',{name:'Run again'}));await waitFor(()=>expect(again).toHaveBeenCalledOnce());expect(resume).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Resume'})).toBeNull();
});
it('resuming a checked checkpoint opens the new native session run',async()=>{
 window.location.hash='#/work?sheet=run%3A31';
 const client=createFakeClient(new FakeEngine()),base=client.request.bind(client);
 client.request=(async(method,params)=>{
  if(method==='venture.runs.resume')return {run:{runId:'new-native-run'},line:'Continued in a new AI session.'};
  const answer=await base(method as never,params as never);
  return method==='venture.runs.get'?{...answer as object,stop:{state:'stopped',line:'A checked draft was saved.'},agentProgress:{messages:[],tools:[],canResume:true}}:answer;
 }) as EngineClient['request'];
 render(<TextProvider language="en"><ClockProvider now={()=>new Date('2026-10-30T12:00:00Z')}><EngineProvider client={client}><RunSheet runId="31" onClose={()=>{}}/></EngineProvider></ClockProvider></TextProvider>);
 const resume=await screen.findByRole('button',{name:'Resume'});await act(async()=>fireEvent.click(resume));
 await waitFor(()=>expect(window.location.hash).toBe('#/work?sheet=run%3Anew-native-run'));
});
it('AI cost is visible with its receipt, while unknown cost has no invented receipt',()=>{
 const view=render(<TextProvider language="en"><AgentProgress progress={{messages:[],tools:[],cost:{display:'USD 0.0020',state:'priced',spendId:'spend_sample',receiptId:'cost_sample'}} as any}/></TextProvider>);
 expect(screen.getByText('USD 0.0020').closest('[data-figure]')).toBeTruthy();expect(screen.getByRole('button',{name:'Receipt for USD 0.0020'})).toBeTruthy();
 view.rerender(<TextProvider language="en"><AgentProgress progress={{messages:[],tools:[],cost:{display:'Final cost is not known. The allowance stays held.',state:'unknown',spendId:'spend_sample'}} as any}/></TextProvider>);
 expect(screen.getByText('Final cost is not known. The allowance stays held.')).toBeTruthy();expect(screen.queryByRole('button',{name:/Receipt for/})).toBeNull();
});
