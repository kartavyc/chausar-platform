// Public fake support flow; original Chausar regression, no private callbacks or store access.
import {it,expect} from 'vitest';
import {FakeEngine} from '../../src/engine/fake';
it('Forget removes a uniquely imported person support ticket, messages and rating',async()=>{
 const engine=new FakeEngine({now:()=> '2026-10-27T10:00:00.000Z'});
 await engine.request('venture.network.import',{kind:'vcard',name:'support-contact.vcf',text:'BEGIN:VCARD\nVERSION:3.0\nFN:Zoya SupportOnly\nEMAIL:zoya@support-only.example\nEND:VCARD'});
 const people=await engine.request('venture.network.people',{query:'Zoya SupportOnly'}) as {people:{id:string}[]};
 const made=await engine.request('venture.desk.act',{playbook:'support-desk',kind:'ticket',id:'new',action:'propose',payload:{thread:'thread_private_zoya',customerEmail:'zoya@support-only.example',subject:'Private parcel',language:'en',blocked:false}}) as {id:string};
 const action=async(name:string,payload:unknown)=>{const view=await engine.request('venture.desk.get',{playbook:'support-desk',kind:'ticket',id:made.id}) as {digest:string};return engine.request('venture.desk.act',{playbook:'support-desk',kind:'ticket',id:made.id,action:name,payload,digest:view.digest});};
 await action('confirm',{});await action('message',{text:'My private support words'});await action('rate',{score:5});
 await engine.request('venture.network.forget',{id:people.people[0]!.id});
 await expect(engine.request('venture.desk.get',{playbook:'support-desk',kind:'ticket',id:made.id})).rejects.toMatchObject({code:'SUPPORT_TICKET_NOT_FOUND'});
 for(const kind of ['message','rating'])expect((await engine.request('venture.desk.list',{playbook:'support-desk',kind}) as {rows:unknown[]}).rows).toEqual([]);
});
it('imported mail reaches the support desk screened and a human request pauses replies',async()=>{
 const engine=new FakeEngine({now:()=> '2026-10-27T10:00:00.000Z'});
 const bytes=new TextEncoder().encode('From: customer@human-request.example\r\nTo: help@shop.example\r\nSubject: A parcel question\r\nMessage-ID: <human-1@example.com>\r\n\r\nPlease connect me to a human.');
 await engine.request('venture.mail.import',{name:'human.eml',contentBase64:btoa(String.fromCharCode(...bytes))});
 const mail=await engine.request('venture.mail.threads',{}) as {threads:{id:string;from:string;subject:string}[]};const thread=mail.threads.find(t=>t.from==='customer@human-request.example')!;
 const made=await engine.request('venture.desk.act',{playbook:'support-desk',kind:'ticket',id:'new',action:'propose',payload:{thread:thread.id,customerEmail:thread.from,subject:thread.subject,language:'en',blocked:false}}) as {id:string};
 const view=await engine.request('venture.desk.get',{playbook:'support-desk',kind:'ticket',id:made.id}) as {item:{messages:{text:string}[];autoDraftsPaused:boolean}};
 expect(view.item.messages[0]?.text).toContain('connect me to a human');expect(view.item.autoDraftsPaused).toBe(true);
});
it('expired snoozes resume at the scheduled time and the shown ticket stays actionable',async()=>{
 let now='2026-10-27T10:00:00.000Z';const engine=new FakeEngine({now:()=>now});
 const made=await engine.request('venture.desk.act',{playbook:'support-desk',kind:'ticket',id:'new',action:'propose',payload:{thread:'late_snooze',customerEmail:'late@shop.example',subject:'Parcel late',language:'en',blocked:false,firstReplyHours:4,shopHours:'सोम-शनि 10:00-19:00'}}) as {id:string};
 const view=()=>engine.request('venture.desk.get',{playbook:'support-desk',kind:'ticket',id:made.id}) as Promise<{digest:string;item:{revision:number;snoozedAt:string|null}}>;
 const act=async(action:string,payload:unknown)=>engine.request('venture.desk.act',{playbook:'support-desk',kind:'ticket',id:made.id,action,payload,digest:(await view()).digest});
 await act('confirm',{});await act('snooze',{until:'2026-10-27T12:00:00.000Z',reason:'Courier check'});now='2026-10-28T18:00:00.000Z';
 const listed=await engine.request('venture.desk.list',{playbook:'support-desk',kind:'ticket',filter:{queue:'overdue'}}) as {rows:unknown[]};expect(listed.rows).toHaveLength(1);
 const current=await view();expect(current.item.snoozedAt).toBeNull();await act('move',{revision:current.item.revision,status:'in-progress',note:'Checking courier'});
});
it('shop customer matches come from an order upload and ambiguous evidence needs owner selection',async()=>{
 const engine=new FakeEngine({now:()=> '2026-10-27T10:00:00.000Z'});const orders=await engine.request('venture.order.list',{}) as {id:string;status:string}[];const order=orders.find(o=>o.status!=='cancelled')!;
 await engine.request('venture.files.add',{orderId:order.id,name:'customers.csv',contentBase64:btoa('customerId,email,phone,orderNumber\nbuyer-a,buyer@example.com,9876543210,SHOP-A')});
 const p=await engine.request('venture.desk.act',{playbook:'support-desk',kind:'ticket',id:'new',action:'propose',payload:{serviceOrderId:order.id,thread:'shop_customer_match',customerEmail:'buyer@example.com',subject:'Parcel',language:'en',blocked:false}}) as {id:string};
 const v=await engine.request('venture.desk.get',{playbook:'support-desk',kind:'ticket',id:p.id}) as {digest:string;item:{customerMatch:{needsConfirmation:boolean;candidates:{id:string;customerId:string}[]}}};expect(v.item.customerMatch.needsConfirmation).toBe(true);expect(v.item.customerMatch.candidates[0]?.customerId).toBe('buyer-a');
 await expect(engine.request('venture.desk.act',{playbook:'support-desk',kind:'ticket',id:p.id,action:'confirm',payload:{},digest:v.digest})).rejects.toMatchObject({code:'SUPPORT_MATCH_REQUIRED'});
 await engine.request('venture.desk.act',{playbook:'support-desk',kind:'ticket',id:p.id,action:'confirm',payload:{matchId:v.item.customerMatch.candidates[0]!.id},digest:v.digest});
});
it('imported signed and visible-number replies route to the existing fake ticket',async()=>{
 const engine=new FakeEngine({now:()=> '2026-10-27T10:00:00.000Z'});const send=async(from:string,to:string,subject:string,id:string,body:string)=>engine.request('venture.mail.import',{name:'reply.eml',contentBase64:btoa(`From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMessage-ID: <${id}@example.com>\r\n\r\n${body}`)});
 await send('buyer@routing.example','help@shop.example','Parcel routing','first','Where is the parcel?');const mail=await engine.request('venture.mail.threads',{}) as {threads:{id:string;from:string}[]};const thread=mail.threads.find(t=>t.from==='buyer@routing.example')!;
 const p=await engine.request('venture.desk.act',{playbook:'support-desk',kind:'ticket',id:'new',action:'propose',payload:{thread:thread.id,customerEmail:'buyer@routing.example',subject:'Parcel routing',language:'en',blocked:false}}) as {id:string};const view=()=>engine.request('venture.desk.get',{playbook:'support-desk',kind:'ticket',id:p.id}) as Promise<{digest:string;item:{number:string;messages:{messageId:string;sender:string}[];autoDraftsPaused:boolean}}>;const act=async(action:string,payload:unknown={})=>engine.request('venture.desk.act',{playbook:'support-desk',kind:'ticket',id:p.id,action,payload,digest:(await view()).digest});await act('confirm');const address=await act('reply-address',{mailbox:'help@shop.example'}) as {result:{replyTo:string}};
 await send('buyer@routing.example',address.result.replyTo,'Another subject','signed','Please connect me to a human.');expect((await view()).item.messages.some(m=>m.messageId==='<signed@example.com>')).toBe(true);expect((await view()).item.autoDraftsPaused).toBe(true);
 const number=(await view()).item.number;await send('stranger@routing.example','help@shop.example',`Help #${number}`,'foreign','Private stranger');expect((await view()).item.messages.some(m=>m.sender==='stranger@routing.example')).toBe(false);
});

it('public fake delivery holds a service order after the owner takes over its support ticket',async()=>{const engine=new FakeEngine({now:()=> '2026-10-27T10:00:00.000Z'});const order=(await engine.request('venture.order.list',{}) as {id:string}[])[0]!;const made=await engine.request('venture.desk.act',{playbook:'support-desk',kind:'ticket',id:'new',action:'propose',payload:{serviceOrderId:order.id,thread:'paused_order',customerEmail:'buyer@shop.example',subject:'Parcel',language:'en',blocked:true}}) as {id:string};await expect(engine.request('venture.delivery.run',{orderId:order.id})).rejects.toMatchObject({code:'SUPPORT_PERSON_REQUIRED'});});
it('fake ticket deadlines inherit the selected order policy',async()=>{const {fakeSupportDeskDesk}=await import('../../src/engine/fake-support-desk');const order={id:'order_a',clientId:'shop_a',status:'open',intake:{fields:{firstReplyHours:'2',resolutionHours:'4',shopHours:'Mon-Sat 09:00-17:00',timeZone:'UTC',holidays:['2026-10-27']}}};const host={current:()=> 'one',now:()=> '2026-10-27T10:00:00Z',emit:()=>{},hosted:()=>false,rows:()=>[],setRows:()=>{},digest:(value:unknown)=>JSON.stringify(value),ask:(method:string)=>method==='venture.order.list'?[order]:[],orderFiles:()=>[]};const desk=fakeSupportDeskDesk(host);const made=desk.kinds.ticket!.act!({id:'new',action:'propose',payload:{serviceOrderId:order.id,thread:'inherited_due',customerEmail:'buyer@shop.example',subject:'Parcel',language:'en',blocked:false}}) as any;expect(made.result.dueAt).toBe('2026-10-28T11:00:00.000Z');expect(made.result.resolutionDueAt).toBe('2026-10-28T13:00:00.000Z');});
