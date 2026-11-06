// Original Chausar fake canvas uses the engine's pure view on the selected order's actual bytes.
import {expect,it} from 'vitest';
import {fakeSocialAgencyDesk} from '../../src/engine/fake-social';
import type {W4DeskHost} from '../../src/engine/fake-w4';
const source='text\nWe teach yoga.\nWe use mats.\nWe practise breathing.\nWe learned to slow down.';
const order={id:'order_1',offerId:'offer_1',request:'Weekly posts',status:'open',intake:{fields:{sourceFile:'upload_1',channels:['linkedin','instagram','x']}}};
const host={current:()=> 'b1',digest:(value:unknown)=>JSON.stringify(value),ask:(method:string)=>method==='venture.order.list'?[order]:method==='venture.blueprint.get'?{blueprint:{offers:[{id:'offer_1',playbookOffer:'repurpose-pack'}]}}:method==='venture.delivery.list'?[{id:'run_1',orderId:'order_1',status:'ready-for-review',practice:false,at:'2026-10-27',deliverable:{title:'Posts'},renderedText:'LinkedIn: We teach yoga.'}]:[],orderFiles:()=>[{id:'upload_1',name:'source.csv',format:'csv',contentBase64:btoa(source),digest:'source'}]} as unknown as W4DeskHost;
it('computes counts and card formats from this order and rejects invalid filters',()=>{
 const kind=fakeSocialAgencyDesk(host).kinds.canvas!;
 expect(kind).toBeDefined();
 const view=kind.get!({playbook:'social-agency',kind:'canvas',id:'order_1'}) as any;
 expect(view.item.inventory.counts.total).toBe(4);
 expect(view.item.cards[0].posts[0].id).toBe('run_1.post-1');
 expect(view.item.cards[1].format).toBe('image-brief');
 expect(()=>kind.list!({playbook:'social-agency',kind:'canvas',filter:{orderId:42}})).toThrow();
 expect(()=>kind.get!({playbook:'social-agency',kind:'canvas',id:'order_other'})).toThrow();
});

it('matches client draft screening and only shows accepted owner edits',()=>{
 const unsafe='password='+'private-value';
 const changed={...host,ask:(method:string,params:Record<string,unknown>)=>method==='venture.delivery.list'?[{id:'run_1',orderId:'order_1',status:'ready-for-review',practice:false,at:'2026-10-27',deliverable:{title:'Posts'},renderedText:'LinkedIn: '+unsafe,editedText:'LinkedIn: Unaccepted replacement.'}]:host.ask(method,params)};
 const view=fakeSocialAgencyDesk(changed).kinds.canvas!.get!({playbook:'social-agency',kind:'canvas',id:'order_1'}) as any;
 expect(view.item.cards[0].posts[0].text).not.toContain('Unaccepted');
 expect(view.item.cards[0].posts[0].text).not.toContain('private-value');
 expect(view.item.cards[0].posts[0].text).toContain('[redacted secret]');
});
