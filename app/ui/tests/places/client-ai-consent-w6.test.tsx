import {describe,it,expect,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {App} from '../../src/shell/App';
import {FakeEngine,createFakeClient} from '../../src/engine/fake';
import {EngineError,type EngineClient} from '../../src/engine/types';
import {digest} from '../../../../platform/runtime/portable';
import {clientAiConsentView} from '../../../../platform/runtime/venture/clients/ai-consent-core';

describe('per-client AI permission',()=>{
 it('fake binds the exact disclosure to this client and revision, supports withdrawal and fresh consent',async()=>{
  const engine=new FakeEngine();const clients=await engine.request('venture.client.list') as {id:string;name:string;email:string|null}[];const client=clients[0]!;
  const view=await engine.request('venture.client.aiConsent.get',{clientId:client.id}) as any;
  const venture=await engine.request('venture.get') as any;
  expect(view.status).toBe('required');expect(view.consent).toBeNull();
  expect(view).toEqual(clientAiConsentView({...client,ventureId:venture.venture.id}));
  expect(view.disclosureDigest).toBe(digest({clientId:client.id,ventureId:venture.venture.id,name:client.name,email:client.email,revision:0,disclosure:view.disclosure}));
  await expect(engine.request('venture.client.aiConsent.agree',{clientId:client.id,disclosureDigest:'old'})).rejects.toMatchObject({code:'CLIENT_AI_CONSENT_CHANGED'});
  const agreed=await engine.request('venture.client.aiConsent.agree',{clientId:client.id,disclosureDigest:view.disclosureDigest}) as any;
  expect(agreed.status).toBe('agreed');expect(agreed.consent.revision).toBe(1);
  expect(agreed).toEqual(clientAiConsentView({...client,ventureId:venture.venture.id,aiConsent:agreed.consent}));
  const withdrawn=await engine.request('venture.client.aiConsent.withdraw',{clientId:client.id}) as any;
  expect(withdrawn.status).toBe('withdrawn');expect(withdrawn.consent.revision).toBe(2);
  await expect(engine.request('venture.client.aiConsent.agree',{clientId:client.id,disclosureDigest:view.disclosureDigest})).rejects.toMatchObject({code:'CLIENT_AI_CONSENT_CHANGED'});
  const fresh=await engine.request('venture.client.aiConsent.agree',{clientId:client.id,disclosureDigest:withdrawn.disclosureDigest}) as any;
  expect(fresh.consent.revision).toBe(3);expect(fresh.consent.id).not.toBe(agreed.consent.id);
  expect((await engine.request('venture.client.aiConsent.get',{clientId:clients[1]!.id}) as any).status).toBe('required');
  await expect(engine.request('venture.client.aiConsent.get',{clientId:client.id,allow:true})).rejects.toMatchObject({code:'INVALID_VENTURE_REQUEST'});
  await expect(engine.request('venture.client.aiConsent.get',{clientId:'missing'})).rejects.toMatchObject({code:'CLIENT_NOT_FOUND'});
 });
 it('an internal agent-facing fake call cannot grant or withdraw client permission',async()=>{
  const engine=new FakeEngine();const view=await engine.request('venture.client.aiConsent.get',{clientId:'c-boat'}) as any;
  const internal=engine as unknown as {answerNow:(method:string,params:Record<string,unknown>)=>unknown};
  expect(()=>internal.answerNow('venture.client.aiConsent.agree',{clientId:'c-boat',disclosureDigest:view.disclosureDigest})).toThrowError(expect.objectContaining({code:'APP_APPROVAL_REQUIRED'}));
  expect(()=>internal.answerNow('venture.client.aiConsent.withdraw',{clientId:'c-boat'})).toThrowError(expect.objectContaining({code:'APP_APPROVAL_REQUIRED'}));
 });
 it('client sheet reads permission without granting and sends the exact displayed consent only on a tap',async()=>{
  window.location.hash='#/clients?sheet=client%3Ac-boat';const client=createFakeClient(new FakeEngine());const spy=vi.spyOn(client,'request');render(<App client={client} language="en"/>);
  const sheet=await screen.findByRole('complementary',{name:'Boat Audio'});const summary=await within(sheet).findByText('AI permission');
  expect(spy.mock.calls.some(([method])=>method==='venture.client.aiConsent.agree')).toBe(false);
  expect(summary.closest('details')?.open).toBe(true);const allow=await within(sheet).findByRole('button',{name:'Allow AI access'});
  expect(sheet.textContent).toContain('Withdrawal stops future sharing');await act(async()=>fireEvent.click(allow));
  await within(sheet).findByRole('button',{name:'Withdraw permission'});
  const grant=spy.mock.calls.find(([method])=>method==='venture.client.aiConsent.agree');expect(grant?.[1]).toMatchObject({clientId:'c-boat',disclosureDigest:expect.any(String)});
  await act(async()=>fireEvent.click(within(sheet).getByRole('button',{name:'Withdraw permission'})));
  await within(sheet).findByRole('button',{name:'Allow AI access'});expect(sheet.textContent).toContain('Withdrawn');
 });
 it('permission read failures stay visible and cannot enable an accidental grant',async()=>{
  window.location.hash='#/clients?sheet=client%3Ac-boat';const client=createFakeClient(new FakeEngine());const base=client.request.bind(client);
  client.request=((method,params)=>method==='venture.client.aiConsent.get'?Promise.reject(new EngineError('READ_FAILED','Permission is unavailable.')):base(method as never,params as never)) as EngineClient['request'];
  render(<App client={client} language="en"/>);const sheet=await screen.findByRole('complementary',{name:'Boat Audio'});await within(sheet).findByText('AI permission');
  await within(sheet).findByText('Permission is unavailable.');expect(within(sheet).queryByRole('button',{name:'Allow AI access'})).toBeNull();
 });
 it('Work: Start refused for permission shows Allow and start, which records it through the sheet call and then starts (B4)',async()=>{
  const engine=new FakeEngine();await engine.request('workspace.open',{folder:'ledgerline'});const client=createFakeClient(engine),base=client.request.bind(client);
  let agreed=false;const runs:unknown[]=[];
  client.request=((method,params)=>{
   if(method==='venture.client.aiConsent.agree')return base(method as never,params as never).then((view:unknown)=>{agreed=true;return view;});
   if(method==='venture.delivery.run'){runs.push(params);return agreed?Promise.resolve({}):Promise.reject(new EngineError('CLIENT_AI_CONSENT_REQUIRED','Allow this client’s data to reach your AI before starting their work.'));}
   return base(method as never,params as never);
  }) as EngineClient['request'];
  const spy=vi.spyOn(client,'request');window.location.hash='#/work';render(<App client={client} language="en"/>);
  const row=(await screen.findByText('Monthly books from October')).closest('li')!;await act(async()=>fireEvent.click(within(row).getByRole('button',{name:'Start'})));
  const allow=await within(row).findByRole('button',{name:'Allow and start'});
  // Refused for permission: a known state, not a red alarm; Start goes so it cannot be refused again, the exact words are one step away.
  expect(within(row).queryByRole('alert')).toBeNull();expect(within(row).getByRole('status').textContent).toContain('Allow this client');
  expect(within(row).queryByRole('button',{name:'Start'})).toBeNull();
  expect(row.querySelector('[data-consent-words]')?.textContent).toContain('Withdrawal stops future sharing');
  expect(spy.mock.calls.some(([method])=>method==='venture.client.aiConsent.agree')).toBe(false);
  await act(async()=>fireEvent.click(allow));
  await waitFor(()=>expect(runs).toHaveLength(2));
  const grant=spy.mock.calls.find(([method])=>method==='venture.client.aiConsent.agree');
  expect(grant?.[1]).toMatchObject({clientId:expect.any(String),disclosureDigest:expect.any(String)});
  const names=spy.mock.calls.map(([method])=>method);expect(names.indexOf('venture.client.aiConsent.agree')).toBeLessThan(names.lastIndexOf('venture.delivery.run'));
  expect(within(row).queryByRole('button',{name:'Allow and start'})).toBeNull();
 });
 it('Work: when the permission changed under it, Allow and start says so and starts nothing (B4)',async()=>{
  const engine=new FakeEngine();await engine.request('workspace.open',{folder:'ledgerline'});const client=createFakeClient(engine),base=client.request.bind(client);const runs:unknown[]=[];
  client.request=((method,params)=>{
   if(method==='venture.client.aiConsent.agree')return Promise.reject(new EngineError('CLIENT_AI_CONSENT_CHANGED','Read the current permission and confirm it again.'));
   if(method==='venture.delivery.run'){runs.push(params);return Promise.reject(new EngineError('CLIENT_AI_CONSENT_REQUIRED','Allow this client’s data to reach your AI before starting their work.'));}
   return base(method as never,params as never);
  }) as EngineClient['request'];
  window.location.hash='#/work';render(<App client={client} language="en"/>);
  const row=(await screen.findByText('Monthly books from October')).closest('li')!;await act(async()=>fireEvent.click(within(row).getByRole('button',{name:'Start'})));
  await act(async()=>fireEvent.click(await within(row).findByRole('button',{name:'Allow and start'})));
  await within(row).findByText(/Read the current permission and confirm it again\./);
  expect(runs).toHaveLength(1);
 });
 // C4 task 19 (161.x1): after Allow, back to the work.
 it('Allow on a client with an order waiting offers to start it, and only the owner\'s press starts it',async()=>{
  const engine=new FakeEngine();await engine.request('workspace.open',{folder:'ledgerline'});const client=createFakeClient(engine),base=client.request.bind(client);
  const clients=await engine.request('venture.client.list') as {id:string;name:string}[];const iyer=clients.find(item=>item.name==='Iyer & Co')!;
  const orders=await engine.request('venture.order.list') as {id:string;clientId:string;request:string}[];const waiting=orders.find(order=>order.request==='Monthly books from October')!;
  client.request=((method,params)=>method==='venture.delivery.run'?Promise.resolve({id:'run_new'}):base(method as never,params as never)) as EngineClient['request'];
  const spy=vi.spyOn(client,'request');window.location.hash=`#/clients?sheet=client%3A${iyer.id}`;render(<App client={client} language="en"/>);
  const sheet=await screen.findByRole('complementary',{name:'Iyer & Co'});await within(sheet).findByText('AI permission');
  expect(within(sheet).queryByRole('button',{name:/order$/})).toBeNull();
  await act(async()=>fireEvent.click(await within(sheet).findByRole('button',{name:'Allow AI access'})));
  const start=await within(sheet).findByRole('button',{name:"Start Iyer & Co's order"});
  expect(spy.mock.calls.some(([method])=>method==='venture.delivery.run')).toBe(false);
  await act(async()=>{fireEvent.click(start);window.dispatchEvent(new HashChangeEvent('hashchange'));});
  const run=spy.mock.calls.filter(([method])=>method==='venture.delivery.run');
  expect(run.map(([,params])=>params)).toEqual([{orderId:waiting.id}]);
  await waitFor(()=>expect(window.location.hash).toContain(`order=${waiting.id}`));
 });
 it('Allow on a client with no order waiting offers nothing more',async()=>{
  window.location.hash='#/clients?sheet=client%3Ac-boat';const client=createFakeClient(new FakeEngine());render(<App client={client} language="en"/>);
  const sheet=await screen.findByRole('complementary',{name:'Boat Audio'});await within(sheet).findByText('AI permission');
  await act(async()=>fireEvent.click(await within(sheet).findByRole('button',{name:'Allow AI access'})));
  await within(sheet).findByRole('button',{name:'Withdraw permission'});
  expect(within(sheet).queryByRole('button',{name:/^Start .+ order$/})).toBeNull();
 });
 it('Work links a missing-permission refusal to the exact client without granting it',async()=>{
  const engine=new FakeEngine();await engine.request('workspace.open',{folder:'ledgerline'});const client=createFakeClient(engine),base=client.request.bind(client);
  client.request=((method,params)=>method==='venture.delivery.run'?Promise.reject(new EngineError('CLIENT_AI_CONSENT_REQUIRED','Allow this client’s data to reach your AI before starting their work.')):base(method as never,params as never)) as EngineClient['request'];
  const spy=vi.spyOn(client,'request');window.location.hash='#/work';render(<App client={client} language="en"/>);
  const row=(await screen.findByText('Monthly books from October')).closest('li')!;await act(async()=>fireEvent.click(within(row).getByRole('button',{name:'Start'})));
  const review=await within(row).findByRole('button',{name:'Review AI permission'});
  await act(async()=>{fireEvent.click(review);window.dispatchEvent(new HashChangeEvent('hashchange'));});
  const sheet=await screen.findByRole('complementary',{name:'Iyer & Co'});await within(sheet).findByText('AI permission');
  expect(spy.mock.calls.some(([method])=>method==='venture.client.aiConsent.agree')).toBe(false);
 });
});
