import {it,expect} from 'vitest';
import {FakeDevDelivery} from '../../src/engine/fake-dev-delivery';
import type {WorkHost} from '../../src/engine/fake-work';
import type {DeliveryLite,OrderLite} from '../../src/engine/types';
import type {DevReport} from '../../../../platform/runtime/venture/playbooks/dev-agency/report';
it('developer delivery copies the code report and refuses changed evidence or edited claims',()=>{
 let report={digest:'before',verdict:{verdict:'Ship'}} as DevReport;const runs:DeliveryLite[]=[],host={current:()=> 'biz',now:()=> '2026-10-29T10:00:00.000Z',plan:()=>({playbook:{id:'dev-agency'}}),devReport:()=>report,emit:()=>{}} as unknown as WorkHost;
 const desk=new FakeDevDelivery(host,{deliveries:()=>runs,keep:r=>runs.push(r)}),run=desk.start({id:'order'} as OrderLite,'run',{orderId:'order'})!;
 expect(run.status).toBe('ready-for-review');expect(run.canAccept).toBe(true);expect(run.renderedText).toContain('Verdict: Ship');
 expect(()=>desk.request('venture.delivery.review',{runId:'run',verdict:'edited',editedText:'Guaranteed safe'})).toThrowError(expect.objectContaining({code:'DERIVED_STALE'}));
 report={...report,digest:'changed'};expect(()=>desk.request('venture.delivery.review',{runId:'run',verdict:'accepted'})).toThrowError(expect.objectContaining({code:'DERIVED_STALE'}));
 desk.eraseOrders('biz',['order']);expect(desk.handles('run')).toBe(false);
});
