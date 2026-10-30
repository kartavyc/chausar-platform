// Tally write boundary tests use synthetic wire fixtures, never claim a real Tally capture.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {createTallyWriteAdapter,type TallyLocalSender} from '../runtime/adapters/accounting/tally-write.ts';
import {digest} from '../runtime/portable.ts';
const externalId='chausar-'+'c'.repeat(32),companyGuid='11111111-1111-1111-1111-111111111111',partyGuid='22222222-2222-2222-2222-222222222222',salesGuid='33333333-3333-3333-3333-333333333333';
const config={companyName:'Owner & Co',companyGuid,port:9000,revision:'one',enabled:true as const,baseCurrency:'INR' as const,currencyName:'INR'};
const entry=(name:string,amount:string,party:boolean)=>`<ALLLEDGERENTRIES.LIST><LEDGERNAME>${name}</LEDGERNAME><ISDEEMEDPOSITIVE>${amount.startsWith('-')?'Yes':'No'}</ISDEEMEDPOSITIVE><ISPARTYLEDGER>${party?'Yes':'No'}</ISPARTYLEDGER><AMOUNT>${amount}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
const voucher=(reference:string,id='7',optional='Yes')=>`<VOUCHER><MASTERID>${id}</MASTERID><GUID>44444444-4444-4444-4444-444444444444</GUID><DATE>20261028</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><ISINVOICE>No</ISINVOICE><ISOPTIONAL>${optional}</ISOPTIONAL><ISCANCELLED>No</ISCANCELLED><PARTYLEDGERNAME>Client &amp; Shop</PARTYLEDGERNAME><REFERENCE>${reference}</REFERENCE>${entry('Client &amp; Shop','-100.00',true)}${entry('Sales','100.00',false)}</VOUCHER>`;
const template=voucher('owner-example');
const row={orderId:'one',source:'source.csv',externalId,originalId:null,postingDate:'2026-10-28',action:'create-draft' as const,reason:'paid-unposted-order',totalMinor:'10000',taxMinor:'0',shippingMinor:'0',lines:[{sku:'service',itemId:salesGuid,amountMinor:'10000'}],receiptId:'test_receipt'};
const mapping={lineMode:'accounting-ledger-amounts' as const,taxTreatment:'not-applicable' as const,partyLedger:{name:'Client & Shop',guid:partyGuid},lines:[{itemId:salesGuid,ledgerName:'Sales',ledgerGuid:salesGuid}],optionalTemplateXml:template};
const response=(data:string)=>`<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER><BODY><DATA>${data}</DATA></BODY></ENVELOPE>`;
function fixture(){
 let status=200,templateNow=template,companyNow=companyGuid;const calls:{body:string;before:boolean}[]=[];let marked=false;let stored='';
 const send:TallyLocalSender=async request=>{assert.equal(request.hostname,'127.0.0.1');assert.equal(request.port,9000);assert.equal(request.path,'/');calls.push({body:request.body,before:marked});let data:string;
 if(request.body.includes('<TALLYREQUEST>Import Data</TALLYREQUEST>')){stored=voucher(externalId,'8');data='<RESPONSE><CREATED>1</CREATED><ALTERED>0</ALTERED><DELETED>0</DELETED><COMBINED>0</COMBINED><IGNORED>0</IGNORED><ERRORS>0</ERRORS><CANCELLED>0</CANCELLED><LASTVCHID>8</LASTVCHID></RESPONSE>';}
 else if(request.body.includes('<SUBTYPE>Company</SUBTYPE>'))data=response(`<COMPANY NAME="Owner &amp; Co"><GUID>${companyNow}</GUID><BASECURRENCYNAME>INR</BASECURRENCYNAME></COMPANY>`);
 else if(request.body.includes('<SUBTYPE>Ledger</SUBTYPE>')){const party=request.body.includes('Client &amp; Shop');data=response(`<LEDGER NAME="${party?'Client &amp; Shop':'Sales'}"><GUID>${party?partyGuid:salesGuid}</GUID><PARENT>${party?'Sundry Debtors':'Sales Accounts'}</PARENT><CURRENCYNAME>INR</CURRENCYNAME><ISBILLWISEON>No</ISBILLWISEON><ISCOSTCENTRESON>No</ISCOSTCENTRESON><GSTAPPLICABLE>Not Applicable</GSTAPPLICABLE></LEDGER>`);}
 else if(request.body.includes('<SUBTYPE>Voucher</SUBTYPE>'))data=response(templateNow);
 else data=response('<COLLECTION>'+stored+'</COLLECTION>');
 return {status,body:Buffer.from(data)};};
 return {send,calls,approve:()=>{marked=true;},setStatus:(value:number)=>{status=value;},setTemplate:(value:string)=>{templateNow=value;},setCompany:(value:string)=>{companyNow=value;},setStored:(value:string)=>{stored=value;}};
}
test('Tally is desktop-only and accepts only an owner-enabled fixed local socket configuration',()=>{
 for(const host of ['hosted-web','local-web','test'])assert.throws(()=>createTallyWriteAdapter(config,{host}),{code:'BOOKS_DESKTOP_ONLY'});
 for(const bad of [{...config,enabled:false},{...config,port:0},{...config,url:'http://example.test'},{...config,companyGuid:''}])assert.throws(()=>createTallyWriteAdapter(bad as typeof config,{host:'desktop'}));
});
test('Tally prepares exact optional XML from validated owner evidence, then approves only at write transport',async()=>{
 const f=fixture(),adapter=createTallyWriteAdapter(config,{host:'desktop',send:f.send});const prepared=await adapter.prepareDraft(row,mapping);assert.equal(prepared.decisionDigest,digest(row));assert.equal(prepared.mappingDigest,digest(mapping));assert.match(prepared.body,/<ISOPTIONAL>Yes<\/ISOPTIONAL>/);assert.match(prepared.body,/<SVCURRENTCOMPANY>Owner &amp; Co<\/SVCURRENTCOMPANY>/);assert.match(prepared.body,/<AMOUNT>-100\.00<\/AMOUNT>/);assert.equal(f.calls.some(c=>c.body.includes('Import Data')),false);await adapter.sendDraft(JSON.parse(JSON.stringify(prepared)),f.approve);const writes=f.calls.filter(c=>c.body.includes('Import Data'));assert.equal(writes.length,1);assert.equal(writes[0]!.before,true);assert.equal(writes[0]!.body,prepared.body);const found=await adapter.readExisting([externalId]);assert.equal(found[0]!.recipientId,partyGuid);assert.equal(found[0]!.materialDigest,prepared.materialDigest);assert.equal(found[0]!.status,'draft');assert.equal(found[0]!.totalMinor,'10000');assert.equal(found[0]!.postingDate,'2026-10-28');assert.match(found[0]!.financialDigest!,/^[a-f0-9]{64}$/);
});
test('Tally rejects regular, executable, duplicate or company-mismatched template evidence',async()=>{
 for(const xml of [template.replace('<ISOPTIONAL>Yes','<ISOPTIONAL>No'),template.replace('<VOUCHER>','<VOUCHER ACTION="Alter">'),template.replace('</VOUCHER>','<ISOPTIONAL>Yes</ISOPTIONAL></VOUCHER>'),'<!DOCTYPE x SYSTEM "http://example.test">'+template,template.replace('</VOUCHER>','<INVENTORYENTRIES.LIST/></VOUCHER>')]){const f=fixture();await assert.rejects(createTallyWriteAdapter(config,{host:'desktop',send:f.send}).prepareDraft(row,{...mapping,optionalTemplateXml:xml}));assert.equal(f.calls.some(c=>c.body.includes('Import Data')),false);}
 const f=fixture();f.setCompany('99999999-9999-9999-9999-999999999999');await assert.rejects(createTallyWriteAdapter(config,{host:'desktop',send:f.send}).prepareDraft(row,mapping),{code:'BOOKS_READ_FAILED'});
});
test('Tally refuses changed template or prepared bytes before owner callback and never retries a failed write',async()=>{
 const f=fixture(),adapter=createTallyWriteAdapter(config,{host:'desktop',send:f.send}),prepared=await adapter.prepareDraft(row,mapping);let approvals=0;await assert.rejects(adapter.sendDraft({...prepared,body:prepared.body.replace('100.00','99.00')},()=>approvals++));f.setTemplate(template.replace('100.00','99.00'));await assert.rejects(adapter.sendDraft(prepared,()=>approvals++));assert.equal(approvals,0);assert.equal(f.calls.some(c=>c.body.includes('Import Data')),false);
 const g=fixture(),other=createTallyWriteAdapter(config,{host:'desktop',send:g.send}),ready=await other.prepareDraft(row,mapping);g.setStatus(302);await assert.rejects(other.sendDraft(ready,()=>approvals++));assert.equal(g.calls.filter(c=>c.body.includes('Import Data')).length,0,'Failed re-read must stop before write');
});
test('Tally template capture never authorizes tax, shipping, refunds or unverified issue conversion',async()=>{
 const f=fixture(),adapter=createTallyWriteAdapter(config,{host:'desktop',send:f.send});for(const changed of [{...row,taxMinor:'100'},{...row,shippingMinor:'100'},{...row,action:'create-refund-draft' as const,originalId:'tally:9',externalId:externalId+'-refund'}])await assert.rejects(adapter.prepareDraft(changed,mapping),{code:'BOOKS_MAPPING_UNSUPPORTED'});let count=0;await assert.rejects(adapter.issue({externalId,id:'tally:7',status:'draft',totalMinor:'10000',financialDigest:'a'.repeat(64),postingDate:'2026-10-28',document:'invoice',originalId:null,recipientId:partyGuid,materialDigest:null},()=>count++),{code:'BOOKS_ISSUE_MANUAL'});assert.equal(count,0);
});
test('Tally missing, duplicate and failed existing lookup evidence never becomes no existing records',async()=>{
 for(const stored of [voucher(externalId,'8')+voucher(externalId,'9'),voucher(externalId,'8').replace('<ISOPTIONAL>Yes</ISOPTIONAL>','')]){const f=fixture();f.setStored(stored);await assert.rejects(createTallyWriteAdapter(config,{host:'desktop',send:f.send}).readExisting([externalId]),{code:'BOOKS_READ_FAILED'});}
 const f=fixture();f.setStatus(500);await assert.rejects(createTallyWriteAdapter(config,{host:'desktop',send:f.send}).readExisting([externalId]),{code:'BOOKS_READ_FAILED'});
});

test('Tally refuses invoice evidence for refund references',async()=>{
 const f=fixture();f.setStored(voucher(externalId+'-refund','8'));await assert.rejects(createTallyWriteAdapter(config,{host:'desktop',send:f.send}).readExisting([externalId+'-refund']),{code:'BOOKS_READ_FAILED'});
});

test('Tally real loopback transport sends exact approved bytes once, honors revocation, and never follows redirects',async()=>{
 const f=fixture();let writes=0,approved=false,writeStatus=200,received='';
 const server=createServer(async(req,res)=>{try{assert.equal(req.method,'POST');assert.equal(req.url,'/');const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=Buffer.concat(chunks).toString('utf8');if(body.includes('Import Data')){writes++;assert.equal(approved,true);received=body;if(writeStatus!==200){res.writeHead(writeStatus,{location:'http://example.test/'});res.end('not confirmed');return;}}const value=await f.send({hostname:'127.0.0.1',port:9000,path:'/',body,timeoutMs:15000,maxBytes:4*1024*1024});res.writeHead(value.status,{'content-type':'text/xml'});res.end(value.body);}catch(error){res.destroy(error as Error);}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));try{const address=server.address();assert.ok(address&&typeof address==='object');const adapter=createTallyWriteAdapter({...config,port:address.port},{host:'desktop'}),prepared=await adapter.prepareDraft(row,mapping);await assert.rejects(adapter.sendDraft(prepared,()=>{throw new Error('revoked');}),/revoked/);assert.equal(writes,0);await adapter.sendDraft(prepared,()=>{approved=true;});assert.equal(writes,1);assert.equal(received,prepared.body);writeStatus=302;await assert.rejects(adapter.sendDraft(prepared,()=>{approved=true;}),{code:'BOOKS_WRITE_UNCONFIRMED'});assert.equal(writes,2,'No redirect or automatic retry after a physical write');}finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});

test('Tally duplicate success counters are unconfirmed, and hostile entry attributes cannot reach a write',async()=>{
 const f=fixture(),adapter=createTallyWriteAdapter(config,{host:'desktop',send:async request=>{const result=await f.send(request);return request.body.includes('Import Data')?{status:200,body:Buffer.from(result.body.toString().replace('</RESPONSE>','<CREATED>1</CREATED></RESPONSE>'))}:result;}});const prepared=await adapter.prepareDraft(row,mapping);await assert.rejects(adapter.sendDraft(prepared,f.approve));assert.equal(f.calls.filter(c=>c.body.includes('Import Data')).length,1);
 await assert.rejects(adapter.prepareDraft(row,{...mapping,optionalTemplateXml:template.replace('<ALLLEDGERENTRIES.LIST>','<ALLLEDGERENTRIES.LIST ACTION="Delete">')}));
});

test('Tally refuses duplicate voucher GUIDs and contradictory ledger signs',async()=>{
 const otherId='chausar-'+'d'.repeat(32),f=fixture();f.setStored(voucher(externalId,'8')+voucher(otherId,'9'));await assert.rejects(createTallyWriteAdapter(config,{host:'desktop',send:f.send}).readExisting([externalId,otherId]),{code:'BOOKS_READ_FAILED'});
});
test('Tally refuses contradictory ledger signs',async()=>{
 const g=fixture();await assert.rejects(createTallyWriteAdapter(config,{host:'desktop',send:g.send}).prepareDraft(row,{...mapping,optionalTemplateXml:template.replace('<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>','<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>')}));
});
