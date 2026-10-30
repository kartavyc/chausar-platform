import {it,expect} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {SeoMonthlyWork} from '../../src/places/work/desks/SeoMonthlyWork';
import {EngineProvider} from '../../src/engine/context';
import {TextProvider} from '../../src/text';
import {FakeEngine,createFakeClient} from '../../src/engine/fake';
import {assertInkRules} from '../helpers/ink-rules';
import type {OrderLite} from '../../src/engine/types';
import {seoManifestCsv} from '../../../../platform/runtime/venture/playbooks/seo-visibility/manifest-core';
it('demo content refuses reused numeric markers and refresh preserves recorded gaps',async()=>{
 const engine=new FakeEngine(),orders=await engine.request('venture.order.list',{}) as OrderLite[],order=orders[0]!;
 const check=async(operation:string,value:unknown)=>{const file=await engine.request('venture.files.add',{orderId:order.id,name:'evidence.csv',contentBase64:btoa(seoManifestCsv(value))}) as {id:string};return engine.request('venture.desk.act',{playbook:'seo-visibility',kind:'work',id:'new',action:'create',payload:{orderId:order.id,uploadId:file.id,operation}}) as Promise<{result:{result:any}}>};
 expect((await check('content',{text:'35% [claim:c1] and 99% [claim:c1].',claims:[{id:'c1',number:'35%',urls:['https://one.example/a','https://two.example/a']}],competitors:[]})).result.result.lint.checks.find((c:any)=>c.id==='claim-markers').pass).toBe(false);
 expect((await check('refresh',{csv:'Query,Page,Clicks,Impressions,Position\nclinic,https://clinic.example/a,1,100,4',gaps:['Opening hours'],missingAi:['Nearby clinic']})).result.result.rows.map((r:any)=>r.action)).toEqual(['title-meta','new-article','ai-overview']);
});
it('owner picks a real order export, reads the plan and approves only the viewed result',async()=>{
 const engine=new FakeEngine();const orders=await engine.request('venture.order.list',{}) as OrderLite[];const order=orders[0]!;
 await engine.request('venture.files.add',{orderId:order.id,name:'search.csv',contentBase64:btoa('Query,Page,Clicks,Impressions,Position\nclinic,https://clinic.example/a,1,100,4')});
 render(<TextProvider language="en"><EngineProvider client={createFakeClient(engine)}><SeoMonthlyWork/></EngineProvider></TextProvider>);
 fireEvent.click(await screen.findByRole('button',{name:'Check search work'}));
 fireEvent.change(screen.getByLabelText('Client order'),{target:{value:order.id}});
 await waitFor(()=>expect(screen.getByRole('option',{name:'search.csv'})).toBeTruthy());
 fireEvent.change(screen.getByLabelText('Source file'),{target:{value:(screen.getByRole('option',{name:'search.csv'}) as HTMLOptionElement).value}});
 fireEvent.submit(screen.getByRole('form',{name:'Check search work'}));
 expect(await screen.findByText('Title and description work')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Approve this checked work'}));
 expect(await screen.findByText('Approved. Nothing was published.')).toBeTruthy();assertInkRules();
});
