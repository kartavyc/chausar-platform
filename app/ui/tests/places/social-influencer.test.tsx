import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {SocialInfluencer} from '../../src/places/work/desks/SocialInfluencer';
import {TextProvider} from '../../src/text';
import {EngineProvider} from '../../src/engine/context';
import {createFakeClient,FakeEngine} from '../../src/engine/fake';
import type {EngineClient} from '../../src/engine/types';
import {newInfluencerCase,changeInfluencerCase} from '../../../../platform/runtime/venture/playbooks/social/influencer-case';
it('owner campaign flow exposes exact creator review, clears state on order switch and never sends',async()=>{
 let item={...newInfluencerCase('o1','2026-10-29T12:00:00Z'),id:'case1',digest:'d1'},prepared=false;const requests:string[]=[],client=createFakeClient(new FakeEngine());
 client.request=vi.fn(async(method:string,p:any)=>{if(method==='venture.order.list')return[{id:'o1',request:'Coffee creator campaign',offerId:'offer1',status:'open'},{id:'o2',request:'Second campaign',offerId:'offer1',status:'open'}];if(method==='venture.blueprint.get')return{blueprint:{offers:[{id:'offer1',playbookOffer:'influencer-campaign'}]}};if(method==='venture.desk.list')return{rows:prepared?[item]:[]};if(method==='venture.desk.act'){requests.push(p.action);prepared=true;if(p.action==='creator')item={...changeInfluencerCase(item,'creator',p.payload,'2026-10-29T12:01:00Z'),id:'case1',digest:'d'+requests.length};return{id:item.id,result:item};}return{};}) as EngineClient['request'];
 render(<TextProvider language="en"><EngineProvider client={client}><SocialInfluencer/></EngineProvider></TextProvider>);
 fireEvent.change(await screen.findByLabelText('Campaign order'),{target:{value:'o1'}});fireEvent.click(screen.getByRole('button',{name:'Prepare campaign'}));
 await screen.findByLabelText('Creator name');fireEvent.change(screen.getByLabelText('Creator name'),{target:{value:'Maya'}});fireEvent.change(screen.getByLabelText('Public profile address'),{target:{value:'https://www.youtube.com/@maya'}});fireEvent.click(screen.getByRole('button',{name:'Save creator'}));
 await waitFor(()=>expect(screen.getByRole('option',{name:'Maya'})).not.toBeNull());expect(requests).toEqual(['prepare','creator']);
 fireEvent.change(screen.getByLabelText('Selected creator'),{target:{value:item.creators[0]!.id}});await screen.findByText('No results have been recorded.');fireEvent.click(screen.getByRole('button',{name:'Edit this creator'}));expect((screen.getByLabelText('Creator name') as HTMLInputElement).value).toBe('Maya');fireEvent.change(screen.getByLabelText('Creator name'),{target:{value:'Maya Studio'}});fireEvent.click(screen.getByRole('button',{name:'Save creator'}));await waitFor(()=>expect(item.creators[0]!.name).toBe('Maya Studio'));expect(item.creators).toHaveLength(1);
 fireEvent.change(screen.getByLabelText('Campaign order'),{target:{value:'o2'}});expect(screen.queryByLabelText('Selected creator')).toBeNull();expect(screen.queryByText('Maya')).toBeNull();
 expect(requests).not.toContain('outreach');
});
