// SEO desk UI: evidence counts come from the engine and approval is bound to the viewed panel.
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SeoVisibilityDesk } from '../../src/places/work/desks/SeoVisibilityDesk';
import { EngineProvider } from '../../src/engine/context';
import { TextProvider } from '../../src/text';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { assertInkRules } from '../helpers/ink-rules';

describe('SEO answer panel desk',()=>{
  it('creates a panel, previews its question list and freezes it through an explicit owner action',async()=>{
    const client=createFakeClient(new FakeEngine());
    render(<TextProvider language="en"><EngineProvider client={client}><SeoVisibilityDesk /></EngineProvider></TextProvider>);
    expect(await screen.findByRole('heading',{name:'Answer panels'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'New answer panel'}));
    fireEvent.change(screen.getByLabelText('Buyer questions'),{target:{value:Array.from({length:15},(_,i)=>`Question ${i}`).join('\n')}});
    fireEvent.click(screen.getByRole('button',{name:'Save panel'}));
    expect(await screen.findByRole('button',{name:'Approve and freeze panel'})).toBeTruthy();
    expect(screen.getByText('Question 0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Approve and freeze panel'}));
    await waitFor(()=>expect(within(screen.getByRole('region',{name:'Review the exact panel'})).getByText('Approved and frozen')).toBeTruthy());
    expect(screen.getByText('No captured answers yet. Missing slots stay in the denominator.')).toBeTruthy();
    assertInkRules();
  });
  it('shows Hindi controls and honest empty evidence',async()=>{
    render(<TextProvider language="hi"><EngineProvider client={createFakeClient(new FakeEngine())}><SeoVisibilityDesk /></EngineProvider></TextProvider>);
    expect(await screen.findByRole('heading',{name:'उत्तर पैनल'})).toBeTruthy();
    expect(screen.getByRole('button',{name:'नया उत्तर पैनल'})).toBeTruthy();
    expect(screen.queryByText('Not built yet')).toBeNull();
  });
});


it('imports a website check, approves its exact report and explicitly schedules the installed checker',async()=>{
 const client=createFakeClient(new FakeEngine());
 render(<TextProvider language="en"><EngineProvider client={client}><SeoVisibilityDesk /></EngineProvider></TextProvider>);
 expect(await screen.findByRole('heading',{name:'Website checks'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Import website report'}));
 fireEvent.change(screen.getByLabelText('Client site URL'),{target:{value:'https://clinic.example/'}});
 const report={url:'https://clinic.example/',runs:[390,1280].flatMap(width=>['light','dark'].map(colorScheme=>({viewport:{width,height:900},colorScheme}))),findings:[]};
 const file=new File([JSON.stringify(report)],'website-report.json',{type:'application/json'});
 fireEvent.change(screen.getByLabelText('lintapple report file'),{target:{files:[file]}});
 fireEvent.submit(screen.getByRole('form',{name:'Import website report'}));
 const approve=await screen.findByRole('button',{name:'Approve this website report'});fireEvent.click(approve);
 const schedule=await screen.findByRole('button',{name:'Approve a 30-day re-check'});fireEvent.click(schedule);
 expect(await screen.findByText('Re-check approved. It needs this desktop and the installed checker.')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Stop website re-checks'}));expect(await screen.findByText('Website re-checks stopped.')).toBeTruthy();
});


it('previews the bounded monitor destination and interval before owner approval',async()=>{
 const client=createFakeClient(new FakeEngine());render(<TextProvider language="en"><EngineProvider client={client}><SeoVisibilityDesk /></EngineProvider></TextProvider>);
 fireEvent.click(await screen.findByRole('button',{name:'New bounded monitor'}));
 fireEvent.change(screen.getByLabelText('Site to watch'),{target:{value:'https://clinic.example/'}});
 fireEvent.change(screen.getByLabelText('Evidence folder'),{target:{value:'C:\\Evidence\\Clinic'}});
 fireEvent.change(screen.getByLabelText('Number of checks'),{target:{value:'2'}});
 fireEvent.change(screen.getByLabelText('Seconds between checks'),{target:{value:'60'}});
 fireEvent.click(screen.getByRole('button',{name:'Review monitor'}));
 const approve=await screen.findByRole('button',{name:'Approve these checks'});expect(screen.getByText('2 checks, at least 60 seconds apart.')).toBeTruthy();
 fireEvent.click(approve);expect(await screen.findByText('Waiting for the next desktop check')).toBeTruthy();expect(screen.getByRole('button',{name:'Stop checks'})).toBeTruthy();assertInkRules();
});

it('does not approve a monitor that changed after its displayed preview',async()=>{
 const engine=new FakeEngine(),client=createFakeClient(engine),request=client.request.bind(client);let changed=false;
 client.request=(async(method:Parameters<typeof request>[0],payload:never)=>{
 const result:any=await request(method,payload);
 if(changed&&method==='venture.desk.get'&&(payload as any)?.kind==='monitor')return {...result,item:{...result.item,url:'https://changed.example/'}};
 return result;
 }) as typeof client.request;
 render(<TextProvider language="en"><EngineProvider client={client}><SeoVisibilityDesk /></EngineProvider></TextProvider>);
 fireEvent.click(await screen.findByRole('button',{name:'New bounded monitor'}));fireEvent.change(screen.getByLabelText('Site to watch'),{target:{value:'https://clinic.example/'}});fireEvent.change(screen.getByLabelText('Evidence folder'),{target:{value:'C:\\Evidence\\Clinic'}});fireEvent.click(screen.getByRole('button',{name:'Review monitor'}));
 const approve=await screen.findByRole('button',{name:'Approve these checks'});changed=true;fireEvent.click(approve);
 expect((await screen.findByRole('alert')).textContent).toContain('This monitor changed. Review the current plan first.');
 const rows:any=await request('venture.desk.list',{playbook:'seo-visibility',kind:'monitor'});expect(rows.rows[0].state).toBe('draft');
});

it('links a new answer panel to the client order selected by name',async()=>{
 const client=createFakeClient(new FakeEngine());const orders=await client.request('venture.order.list',{});expect(orders.length).toBeGreaterThan(0);const order=orders[0]!;
 render(<TextProvider language="en"><EngineProvider client={client}><SeoVisibilityDesk /></EngineProvider></TextProvider>);
 fireEvent.click(await screen.findByRole('button',{name:'New answer panel'}));
 fireEvent.change(screen.getByLabelText('Client order'),{target:{value:order.id}});
 fireEvent.change(screen.getByLabelText('Buyer questions'),{target:{value:Array.from({length:15},(_,i)=>`Question ${i}`).join('\n')}});fireEvent.click(screen.getByRole('button',{name:'Save panel'}));
 await screen.findByRole('button',{name:'Approve and freeze panel'});
 const listed:any=await client.request('venture.desk.list',{playbook:'seo-visibility',kind:'panel'});const detail:any=await client.request('venture.desk.get',{playbook:'seo-visibility',kind:'panel',id:listed.rows[0].id});expect(detail.item.panel.orderId).toBe(order.id);
});
