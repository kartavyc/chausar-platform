import { it, expect } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { askChausar, takeAsk } from '../../src/shell/ask';
import {openSheet,returnFocus} from '../../src/shell/navigation';

it('actual Forget clears local fields and pending Ask words without clearing ordinary refresh drafts', async () => {
  window.location.hash = '#/today';
  const engine = new FakeEngine(), client = createFakeClient(engine);
  const view = render(<App client={client} language="en" />);
  const input = await screen.findByRole('textbox', { name: 'Ask Chausar anything' });
  fireEvent.change(input, { target: { value: 'Fictional privacy contact private draft' } });
  await act(async () => { engine.emit({ type: 'desk.changed', businessId: 'lumen', at: '2026-10-29T04:30:00Z' }); });
  expect((screen.getByRole('textbox', { name: 'Ask Chausar anything' }) as HTMLInputElement).value).toContain('private draft');
  await act(async () => {
    await client.request('venture.network.import', { kind: 'contacts-csv', name: 'fictional.csv', text: 'Name,E-mail 1 - Value\nFictional privacy contact,fictional@example.org' });
    const people = await client.request('venture.network.people', { query: 'Fictional privacy contact' });
    await client.request('venture.network.forget', { id: people.people[0]!.id });
  });
  expect(takeAsk()).toBeNull();
  await waitFor(() => expect((screen.getByRole('textbox', { name: 'Ask Chausar anything' }) as HTMLInputElement).value).toBe(''));
  // Ctrl K's module-level fallback must not resurrect a previously erased draft.
  view.unmount();
  act(() => { askChausar(); });
  expect(takeAsk()).toBe('');
});

it('actual Forget clears an Ask handoff queued before Chats mounted', async () => {
  askChausar('Fictional queued private words');
  window.location.hash = '#/today';
  const client = createFakeClient(new FakeEngine());
  render(<App client={client} language="en" />);
  await screen.findByRole('textbox', { name: 'Ask Chausar anything' });
  await act(async () => {
    await client.request('venture.network.import', {kind:'contacts-csv',name:'fictional.csv',text:'Name,E-mail 1 - Value\nQueued fictional contact,queued@example.org'});
    const people = await client.request('venture.network.people', {query:'Queued fictional contact'});
    await client.request('venture.network.forget', {id:people.people[0]!.id});
  });
  expect(takeAsk()).toBeNull();
});

it('actual Forget releases the old sheet focus origin instead of retaining its private DOM',async()=>{
  window.location.hash='#/today';const client=createFakeClient(new FakeEngine());render(<App client={client} language="en"/>);
  const input=await screen.findByRole('textbox',{name:'Ask Chausar anything'});fireEvent.change(input,{target:{value:'Fictional private words in an old DOM node'}});
  act(()=>openSheet('unknown','privacy-check',input));
  await act(async()=>{await client.request('venture.network.import',{kind:'contacts-csv',name:'fictional.csv',text:'Name,E-mail 1 - Value\nFocus fictional contact,focus@example.org'});const people=await client.request('venture.network.people',{query:'Focus fictional contact'});await client.request('venture.network.forget',{id:people.people[0]!.id});});
  let reads=0;Object.defineProperty(input,'isConnected',{configurable:true,get(){reads++;return false;}});
  act(()=>{window.location.hash='#/today';returnFocus();});
  expect(reads).toBe(0);
});
