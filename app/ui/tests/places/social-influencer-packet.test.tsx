import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {InfluencerPacket} from '../../src/places/work/desks/InfluencerPacket';
import {TextProvider} from '../../src/text';
import {EngineProvider} from '../../src/engine/context';
import {createFakeClient,FakeEngine} from '../../src/engine/fake';
import type {EngineClient} from '../../src/engine/types';
import type {InfluencerView} from '../../../../platform/runtime/venture/playbooks/social/influencer-case';
import {newInfluencerCase} from '../../../../platform/runtime/venture/playbooks/social/influencer-case';
it('owner sees source-bound packet and receipts before exact export and stale results never download',async()=>{
 const row={...newInfluencerCase('o1','2026-10-29T12:00:00Z'),id:'case1',digest:'d1'} as InfluencerView;
 const packet={sourceDigest:'d1',language:'en',title:'Campaign handoff',sections:[{heading:'Maya',lines:['No creator agreement is implied.'],figures:[{label:'Your fee',value:'₹250.00',receiptId:'r1',estimate:false}]}],receipts:[{digest:'r1'}],content:'Exact reviewed packet',filename:'influencer-campaign.md',digest:'p1'};
 const client=createFakeClient(new FakeEngine()),calls:any[]=[],save=vi.fn();client.request=vi.fn(async(_m:string,p:any)=>{calls.push(p);return{id:row.id,result:packet};}) as EngineClient['request'];
 const view=render(<TextProvider language="en"><EngineProvider client={client}><InfluencerPacket key={row.digest} row={row} save={save}/></EngineProvider></TextProvider>);
 expect(screen.queryByRole('button',{name:'Export this packet'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Review campaign packet'}));await screen.findByText('No creator agreement is implied.');expect(save).not.toHaveBeenCalled();expect(document.querySelector('[data-receipt]')).not.toBeNull();fireEvent.click(screen.getByRole('button',{name:'Export this packet'}));await waitFor(()=>expect(save).toHaveBeenCalledWith('Exact reviewed packet','influencer-campaign.md'));expect(calls[1]).toMatchObject({action:'packet-export',digest:'d1',payload:{language:'en',packetDigest:'p1'}});
 view.rerender(<TextProvider language="en"><EngineProvider client={client}><InfluencerPacket key="d2" row={{...row,digest:'d2'}} save={save}/></EngineProvider></TextProvider>);expect(screen.queryByRole('button',{name:'Export this packet'})).toBeNull();
});
