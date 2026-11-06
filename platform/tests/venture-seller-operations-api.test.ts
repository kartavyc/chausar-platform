import {handlers as sellerHandlers} from '../runtime/venture/playbooks/index.ts';
// Original Chausar seller operations tests at the public owner boundary.
import test from 'node:test';import assert from 'node:assert/strict';
import {kitBusiness,owner} from './fixtures/venture/kit-business.ts';
import {listRecords} from '../runtime/venture/records.ts';
async function setup(){const env=await kitBusiness({now:new Date('2026-10-28T10:00:00Z')},{idea:'Online seller back office'});const offer=env.offers.find(o=>o.playbookOffer==='own-shop-back-office')!;const order=await env.call('venture.order.create',{offerId:offer.id,request:'Keep my own stock and listings.'});return {...env,order};}
const csv='sku,channel,priceMinor,breakEvenMinor,stock,title,currency\nA,shopify,10000,6000,8,Cotton bag,INR';
const caps={priceChangeBps:'2500',promotionBps:'2000'};
const act=(env:any,action:string,payload:unknown,id=env.order.id,digest?:string)=>env.call('venture.desk.act',{playbook:'online-seller',kind:'operations',id,action,payload,...(digest?{digest}:{})});
test('public staged handoff binds session reads, exact owner review, money second ask and current caps',async()=>{
 const env=await setup();const read=await act(env,'read',{orderId:env.order.id,name:'products.csv',contentBase64:Buffer.from(csv).toString('base64'),caps});assert.equal(read.result.products[0].sku,'A');
 await assert.rejects(act(env,'stage',{readId:'invented',sku:'A',channel:'shopify',change:{field:'price',value:'9000'}}),{code:'SELLER_PROVENANCE_REQUIRED'});
 const staged=await act(env,'stage',{readId:read.result.readId,sku:'A',channel:'shopify',change:{field:'price',value:'9000'}});assert.equal(staged.result.status,'staged');assert.equal(staged.result.proposal.capability,'handoff');
 await assert.rejects(act(env,'handoff',{},staged.id,staged.result.digest),{code:'SELLER_APPROVAL_REQUIRED'});
 const confirmed=await act(env,'confirm',{name:null},staged.id,staged.result.digest);assert.equal(confirmed.result.status,'confirmed');assert.equal(confirmed.result.secondAsk,true);
 const done=await act(env,'handoff',{},staged.id,confirmed.result.digest);assert.equal(done.result.status,'handoff');assert.equal(done.result.marketplaceApplied,false);assert.match(done.result.file.text,/A/);
 await assert.rejects(act(env,'handoff',{},staged.id,confirmed.result.digest),{code:'SELLER_STAGE_STALE'});
 const staged2=await act(env,'stage',{readId:read.result.readId,sku:'A',channel:'shopify',change:{field:'price',value:'9000'}});const yes=await act(env,'confirm',{name:null},staged2.id,staged2.result.digest);
 await act(env,'read',{orderId:env.order.id,name:'products.csv',contentBase64:Buffer.from(csv).toString('base64'),caps:{...caps,priceChangeBps:'500'}});
 await assert.rejects(act(env,'handoff',{},staged2.id,yes.result.digest),{code:'SELLER_CAP_EXCEEDED'});
 assert.equal(listRecords(env.store.read(),'venture-seller-stage').length,2);
});
test('stock CAS and owner-route refusals hold at public operations boundaries',async()=>{
 const env=await setup();const read=await act(env,'read',{orderId:env.order.id,name:'products.csv',contentBase64:Buffer.from(csv).toString('base64'),caps});const staged=await act(env,'stage',{readId:read.result.readId,sku:'A',channel:'shopify',change:{field:'stock',value:'9'}});const yes=await act(env,'confirm',{name:null},staged.id,staged.result.digest);
 await act(env,'read',{orderId:env.order.id,name:'products.csv',contentBase64:Buffer.from(csv.replace(',8,',',7,')).toString('base64'),caps});await assert.rejects(act(env,'handoff',{},staged.id,yes.result.digest),{code:'SELLER_STOCK_CHANGED'});
 await assert.rejects(sellerHandlers['venture.desk.act']!(env.deps,{...owner,channel:'mcp'},{playbook:'online-seller',kind:'operations',id:env.order.id,action:'read',payload:{orderId:env.order.id,name:'products.csv',contentBase64:Buffer.from(csv).toString('base64'),caps}}),{code:'APP_APPROVAL_REQUIRED'});
});

test('public operations compute receipted research and safe workbook rows, and record immutable movements and cases',async()=>{
 const env=await setup();const research='id,title,keyword,priceMinor,feeMinor,reviews,ratingBps,recentReviewSpike,seasonMonths,source\np1,Disney bag,bag,10000,2000,20,400,no,10,Owner export';
 const report=await act(env,'analyse',{orderId:env.order.id,mode:'research',name:'research.csv',contentBase64:Buffer.from(research).toString('base64'),options:{month:10,trademarks:['Disney'],profile:'beginner'}});assert.equal(report.result.data[0].verdict,'NO-GO');assert.ok(report.result.receiptId);
 const movement={id:'import-1',sku:'A',counter:'onHand',delta:'10',authority:'warehouse',source:'Owner counted shelf',at:'2026-10-28T10:00:00Z'};
 const moved=await act(env,'movement',{orderId:env.order.id,movement});assert.equal(moved.result.counters[0].onHand,'10');await assert.rejects(act(env,'movement',{orderId:env.order.id,movement}),{code:'SELLER_MOVEMENT_DUPLICATE'});
 const record=await act(env,'case',{orderId:env.order.id,data:{reference:'Case A',status:'closed',deadline:{on:'2026-11-01',kind:'owner',source:'Owner note'},attachments:[],timeline:[]}});assert.equal(record.result.data.solved,false);assert.equal(listRecords(env.store.read(),'venture-seller-case').length,1);
});

test('photo handoff waits for exact quote approval, retains the main reference, and imports every generated image as an asset',async()=>{
 const env=await setup();const photo=env.offers.find(o=>o.playbookOffer==='product-photos')!;const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOmgAAAAASUVORK5CYII=';
 env.order=await env.call('venture.order.create',{clientId:env.client.id,offerId:photo.id,request:'Product photos',intake:{rights:{basis:'own-footage',holder:'Owner shop',reference:null,scope:null,expiresOn:'2026-10-29'},fields:{permission:true,brandText:'Acme bag'}},intakeFiles:{mainImage:{name:'main.png',contentBase64:png}}});const main=await env.call('venture.files.add',{orderId:env.order.id,name:'real-main.png',contentBase64:png});
 const brief={mainImage:main.id,brandText:'Acme bag',protectedPhrases:['Acme'],bannedWords:['guaranteed'],background:'white',palette:'green',font:'plain',icons:'none',variants:[{kind:'secondary',reference:main.id,background:'white',palette:'green',font:'plain',icons:'none',prompt:'Show the actual bag.',fakeUi:false,frames:false,watermarks:false}],quote:{provider:'Owner image app',currency:'INR',unitMinor:'1000',source:'Provider quote seen by owner',expiresAt:'2026-10-29T00:00:00Z'}};
 const quoted=await act(env,'photo-quote',{orderId:env.order.id,brief});assert.equal(quoted.result.proposal.generated,false);assert.equal(quoted.result.proposal.calls[0].references[0],main.id); assert.ok(quoted.result.receiptId);assert.ok(quoted.result.figures.some((figure:any)=>figure.key==='totalMinor'&&figure.display==='INR 10.00'&&figure.receiptId===quoted.result.receiptId));
 const output={variant:0,name:'secondary.png',contentBase64:png,licence:'Owner confirmed provider licence'};
 await assert.rejects(act(env,'photo-import',output,quoted.id,quoted.result.digest),{code:'SELLER_APPROVAL_REQUIRED'});
 const {ventureAction}=await import('../runtime/venture/records.ts');const original=env.store.read().conversations.find((r:any)=>r.id===env.order.id) as any;await ventureAction(env.deps,owner,'admin','test.rights-expired',tx=>{const o=tx.find('venture-order',env.order.id)!;tx.replace({...o,intake:{...o.intake!,rights:{...o.intake!.rights!,expiresOn:'2026-10-27'}}});});await assert.rejects(act(env,'photo-confirm',{},quoted.id,quoted.result.digest),{code:'RIGHTS_REQUIRED'});await ventureAction(env.deps,owner,'admin','test.rights-restored',tx=>{tx.replace(original);});const approved=await act(env,'photo-confirm',{},quoted.id,quoted.result.digest);
 const originalUpdate=env.store.update.bind(env.store);let revoke=true;env.store.update=async function(change){const result=await originalUpdate(change);if(revoke&&listRecords(env.store.read(),'venture-upload').some(u=>u.name==='blocked-secondary.png')){revoke=false;await originalUpdate(state=>{const o=state.conversations.find((r:any)=>r.id===env.order.id) as any;o.intake.rights=null;});}return result;};await assert.rejects(act(env,'photo-import',{...output,name:'blocked-secondary.png'},quoted.id,approved.result.digest),{code:'RIGHTS_REQUIRED'});assert.equal(listRecords(env.store.read(),'venture-asset').length,0);env.store.update=originalUpdate;await ventureAction(env.deps,owner,'admin','test.rights-restored',tx=>{tx.replace(original);});const imported=await act(env,'photo-import',output,quoted.id,approved.result.digest);assert.ok(imported.result.asset.id);const assets=listRecords(env.store.read(),'venture-asset');assert.equal(assets.length,1);assert.equal(assets[0].source.kind,'generated');assert.equal(assets[0].orderId,env.order.id);
});

test('handoff preserves exact promotion bounds and neutralizes spreadsheet formula cells',async()=>{
 const env=await setup();const hostile=csv.replace('A,shopify','=1+1,shopify');const read=await act(env,'read',{orderId:env.order.id,name:'products.csv',contentBase64:Buffer.from(hostile).toString('base64'),caps});
 const staged=await act(env,'stage',{readId:read.result.readId,sku:'=1+1',channel:'shopify',change:{field:'promotion',value:'Owner sale',scope:'This SKU only',depthBps:'1000',endsOn:'2026-11-01'}});
 const approved=await act(env,'confirm',{name:null},staged.id,staged.result.digest);const done=await act(env,'handoff',{},staged.id,approved.result.digest);
 assert.match(done.result.file.text,/"'=1\+1"/);assert.match(done.result.file.text,/This SKU only/);assert.match(done.result.file.text,/1000/);assert.match(done.result.file.text,/2026-11-01/);
});

test('owner forms parse rupees and percent caps in code and return a stored change receipt',async()=>{
 const env=await setup();const read=await act(env,'read',{orderId:env.order.id,name:'products.csv',contentBase64:Buffer.from(csv).toString('base64'),caps:{priceChangePercent:'25',promotionPercent:'20'}});
 const staged=await act(env,'stage',{readId:read.result.readId,sku:'A',channel:'shopify',change:{field:'price',rupees:'90.25'}});
 assert.equal(staged.result.proposal.change.value,'9025');
 assert.equal(staged.result.figures.find((f:any)=>f.key==='afterMinor').display,'INR 90.25');
 assert.ok(listRecords(env.store.read(),'venture-work-receipt').find(r=>r.id===staged.result.receiptId));
 await assert.rejects(act(env,'stage',{readId:read.result.readId,sku:'A',channel:'shopify',change:{field:'price',rupees:'90',value:'9000'}}),{code:'SELLER_INPUT_INVALID'});
});
test('owner can reopen source-backed cases and receipted stock movements',async()=>{
 const env=await setup();const movement={id:'count-a',sku:'A',counter:'onHand',delta:'10',authority:'warehouse',source:'Owner counted shelf',at:'2026-10-28T10:00:00Z'};
 const moved=await act(env,'movement',{orderId:env.order.id,movement});assert.ok(moved.result.receiptId);assert.equal(moved.result.figures.find((f:any)=>f.key==='1.onHand').display,'10');
 await act(env,'case',{orderId:env.order.id,data:{reference:'Case A',status:'closed',deadline:{on:'2026-11-01',kind:'owner',source:'Owner note'},attachments:[],timeline:[]}});
 const cases=await env.call('venture.desk.list',{playbook:'online-seller',kind:'operations',filter:{orderId:env.order.id,view:'cases'}});assert.equal(cases.rows[0].data.reference,'Case A');
});



test('Forget erases seller case, movement, staged preview and their source receipts',async()=>{
 const env=await setup();const {handlers}=await import('../runtime/venture/network/index.ts');const {ventureAction}=await import('../runtime/venture/records.ts');
 await handlers['venture.network.import']!(env.deps,owner,{kind:'contacts-csv',name:'contacts.csv',text:'Name,Email\nAsha Rao,asha@example.test'});
 const person=listRecords(env.store.read(),'venture-person').find(p=>p.name==='Asha Rao')!;assert.ok(person);
 await ventureAction(env.deps,owner,'admin','test.seller-person',tx=>{tx.replace({...tx.find('venture-person',person.id)!,clientId:env.order.clientId});});
 const read=await act(env,'read',{orderId:env.order.id,name:'products.csv',contentBase64:Buffer.from(csv).toString('base64'),caps});await act(env,'stage',{readId:read.result.readId,sku:'A',channel:'shopify',change:{field:'price',value:'9000'}});
 await act(env,'case',{orderId:env.order.id,data:{reference:'Asha Rao case',status:'open',deadline:null,attachments:[],timeline:[]}});await act(env,'movement',{orderId:env.order.id,movement:{id:'asha-count',sku:'A',counter:'onHand',delta:'1',authority:'warehouse',source:'Asha Rao count',at:'2026-10-28T10:00:00Z'}});
 await handlers['venture.network.forget']!(env.deps,owner,{id:person.id});for(const kind of ['venture-seller-stage','venture-seller-movement','venture-seller-case','venture-work-receipt'] as const)assert.equal(listRecords(env.store.read(),kind).length,0,kind);assert.ok(!listRecords(env.store.read(),'venture-upload').some(u=>u.id===read.result.sourceId));
});

test('same SKU on two channels stages exactly the owner-selected channel',async()=>{const env=await setup();const read=await act(env,'read',{orderId:env.order.id,name:'products.csv',contentBase64:Buffer.from(csv+'\nA,amazon,11000,6000,5,Cotton bag,INR').toString('base64'),caps});const stage=await act(env,'stage',{readId:read.result.readId,sku:'A',channel:'amazon',change:{field:'price',value:'10000'}});assert.equal(stage.result.proposal.product.channel,'amazon');});
