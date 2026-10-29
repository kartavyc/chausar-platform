// Original Chausar accounting posting loop. Complete dry runs, one claimed action per document.
import {check,authorize,type Context,type State} from '../../contracts.ts';
import type {VentureDeps,BooksPostingRecord,WorkReceiptRecord} from '../contracts.ts';
import {readVenture,listRecords,digest,exactPayload,requireAppChannel,ventureAction} from '../records.ts';
import {journalled} from '../journal/journal.ts';
import {gateEffect,sealApproval} from '../policy/holds.ts';
import {prepareBooksBatch,booksFinancialDigest,validateBooksExisting,type BooksOrder,type PostingDecision,type ExistingBooksRecord} from '../playbooks/bookkeeping-cfo/posting-core.ts';
import type {ZohoPreparedDraft} from '../../adapters/accounting/zoho-write-types.ts';
import {formatMinor} from '../../currency.ts';
import {postingSource} from '../playbooks/bookkeeping-cfo/posting-source.ts';
export type BooksTarget={identity:string;system:'zoho'|'tally';companyId:string;readExisting:(ids:readonly string[])=>Promise<ExistingBooksRecord[]>;prepareDraft:(row:PostingDecision)=>Promise<ZohoPreparedDraft>;createDraft:(prepared:ZohoPreparedDraft,beforeSend:()=>void)=>Promise<void>;issue:(row:ExistingBooksRecord,beforeSend:()=>void)=>Promise<void>};
import type {BooksPostingEntry} from '../playbooks/bookkeeping-cfo/posting-types.ts';
type PostingRecord=BooksPostingRecord&{entry:BooksPostingEntry};
function seal(row:PostingRecord):PostingRecord {return {...row,entry:{...row.entry,reviewDigest:digest({...row.entry,reviewDigest:''})}};}
function source(state:State,ventureId:string,input:{cycleId?:string;orderId:string;uploadId:string},cycleIdentity?:string){
 const order=listRecords(state,'venture-order',ventureId).find(row=>row.id===input.orderId);check(order,'ORDER_NOT_FOUND','Choose the client bookkeeping order.');check(order.status!=='cancelled','ORDER_CANCELLED','This client order was cancelled.');check(order.intake?.fields?.['data-consent']===true,'BOOKS_CONSENT_REQUIRED','Confirm current client consent before using these records.');
 const cycle=listRecords(state,'venture-books-posting',ventureId).find(row=>row.entry.kind==='cycle'&&(input.cycleId?row.id===input.cycleId:row.cycleId===cycleIdentity));check(cycle&&cycle.entry.kind==='cycle'&&cycle.clientId===order.clientId,'BOOKS_CYCLE_INVALID','Choose this client finance cycle.');
 const upload=listRecords(state,'venture-upload',ventureId).find(row=>row.id===input.uploadId&&row.scope.kind==='order'&&row.scope.orderId===order.id);check(upload,'BOOKS_SOURCE_CHANGED','The order source was removed.');
 check(Buffer.byteLength(upload.contentBase64,'base64')<=1000000,'BOOKS_INPUT_INVALID','Use a source file below one megabyte.');
 return {order,cycle:cycle.entry.cycle,upload,digest:digest({id:upload.id,bytes:upload.contentBase64,cycle:cycle.entry.cycle,clientId:order.clientId})};
}
function current(deps:VentureDeps,ctx:Context,id:string):PostingRecord{const {state,venture}=readVenture(deps,ctx);const row=listRecords(state,'venture-books-posting',venture.id).find(value=>value.id===id);check(row?.entry.kind==='posting','BOOKS_WORK_NOT_FOUND','Choose the accounting dry run.');return row as PostingRecord;}
function unchanged(deps:VentureDeps,ctx:Context,target:BooksTarget,row:PostingRecord){const {state,venture}=readVenture(deps,ctx),now=current(deps,ctx,row.id);check(now.entry.target===target.identity&&seal(now).entry.reviewDigest===now.entry.reviewDigest,'APPROVAL_STALE','This accounting proposal or connection changed.');const live=source(state,venture.id,{orderId:now.orderId,uploadId:now.entry.uploadId},now.cycleId);check(live.digest===now.entry.sourceDigest,'BOOKS_SOURCE_CHANGED','The client source or cycle changed. Prepare another dry run.');check(live.cycle.system===target.system&&live.cycle.companyId===target.companyId,'APPROVAL_STALE','The accounting company changed.');return now;}
function matches(row:PostingDecision,found:ExistingBooksRecord|undefined,state:'draft'|'issued',prepared:ZohoPreparedDraft|undefined){if(found)validateBooksExisting([found],new Set([row.externalId]));return !!found&&!!prepared&&found.recipientId===prepared.mapping.customerId&&found.materialDigest!==null&&found.materialDigest===prepared.materialDigest&&found.externalId===row.externalId&&found.status===state&&found.postingDate===row.postingDate&&found.document===(row.action==='create-refund-draft'?'credit-note':'invoice')&&found.originalId===row.originalId&&found.totalMinor===row.totalMinor&&found.financialDigest===booksFinancialDigest(row);}
async function save(deps:VentureDeps,ctx:Context,id:string,update:(entry:BooksPostingEntry)=>BooksPostingEntry){return ventureAction(deps,ctx,'approve','books.posting.state',tx=>{const row=tx.find('venture-books-posting',id);check(row?.entry.kind==='posting','BOOKS_WORK_NOT_FOUND','This dry run was removed.');const next=seal({...row,entry:update(row.entry)});tx.replace(next);tx.emit('desk.changed',{playbook:'bookkeeping-cfo',kind:'finance',id});return next;});}
function checkPrepared(value:ZohoPreparedDraft,decision:PostingDecision,identity:string){check(value&&value.connectionIdentity===identity&&typeof value.materialDigest==='string'&&/^[a-f0-9]{64}$/.test(value.materialDigest)&&value.decisionDigest===digest(decision)&&digest(value.decision)===digest(decision)&&value.digest===digest({...value,digest:''})&&typeof value.body==='string'&&Buffer.byteLength(value.body)<=1000000,'APPROVAL_STALE','The prepared request must bind the exact accounting decision and connection.');}
function postingSubject(target:Pick<BooksTarget,'system'|'companyId'>,externalId:string,operation:'draft'|'issue'){return 'books.'+digest({system:target.system,companyId:target.companyId,externalId})+'.'+operation;}
function postingHistory(state:State,ventureId:string,subject:string,ownEntry?:string){check(!listRecords(state,'venture-journal-entry',ventureId).some(entry=>entry.id!==ownEntry&&entry.subject===subject&&['approved','applied','outcome_unknown'].includes(entry.state)),'BOOKS_ALREADY_SENT','This accounting identity was already sent or needs an outcome check. It cannot be recreated through another dry run.');}
/** Reconcile an interrupted local row with durable claims. No remote call or retry occurs here. */
export async function reconcileBooksPosting(deps:VentureDeps,ctx:Context,id:string):Promise<PostingRecord>{
 requireAppChannel(ctx,'venture.desk.act');authorize(deps.store,ctx,'approve');const row=current(deps,ctx,id),state=deps.store.read();
 check(['applying','issuing','drafted'].includes(row.entry.state),'BOOKS_NOT_INTERRUPTED','Only an active or drafted accounting run needs this check.');
 const cycle=listRecords(state,'venture-books-posting',row.ventureId).find(value=>value.cycleId===row.cycleId&&value.entry.kind==='cycle');check(cycle?.entry.kind==='cycle','BOOKS_CYCLE_INVALID','The finance cycle was removed.');
 const entries=listRecords(state,'venture-journal-entry',row.ventureId),target=cycle.entry.cycle;
 const outcomes=row.entry.outcomes.map(value=>{
  const issue=entries.filter(entry=>entry.subject===postingSubject(target,value.externalId,'issue')).at(-1);
  check(issue?.state!=='approved','BOOKS_STILL_RUNNING','Issuing is still claimed. Wait for the journal outcome check.');
  if(issue&&['applied','outcome_unknown'].includes(issue.state))return value.state==='issued'?value:{...value,state:'outcome_unknown' as const};
  if(value.state==='issuing')return {...value,state:'drafted' as const};
  const journal=entries.filter(entry=>entry.subject===postingSubject(target,value.externalId,'draft')).at(-1);
  check(journal?.state!=='approved','BOOKS_STILL_RUNNING','This accounting action is still claimed. Wait for the journal outcome check.');
  if(value.state!=='pending')return value;
  return {...value,state:!journal||journal.state==='rejected'?'not-sent' as const:'outcome_unknown' as const};
 });
 return save(deps,ctx,id,entry=>({...entry,outcomes,state:outcomes.some(value=>value.state==='outcome_unknown')?'outcome_unknown':outcomes.every(value=>value.state==='drafted'||value.state==='issued')?'drafted':'stopped'}));
}
/** Only uploaded source orders enter a dry run. No action is approved by preparing it. */
export async function stageBooksPosting(deps:VentureDeps,ctx:Context,target:BooksTarget,raw:unknown):Promise<PostingRecord>{
 requireAppChannel(ctx,'venture.desk.act');authorize(deps.store,ctx,'approve');const b=exactPayload(raw,['cycleId','orderId','uploadId'],['cycleId','orderId','uploadId']) as {cycleId:string;orderId:string;uploadId:string};
 const {state,venture}=readVenture(deps,ctx),input=source(state,venture.id,b);check(input.cycle.system===target.system&&input.cycle.companyId===target.companyId,'APPROVAL_STALE','Connect the company selected for this cycle.');
 check(typeof target.identity==='string'&&target.identity.length>0&&target.identity.length<=120,'BOOKS_CONNECTION_INVALID','Use a bounded accounting connection identity.');const identity=target.identity;
 check(input.upload.format==='csv','BOOKS_INPUT_INVALID','Upload the source orders CSV.');const orders=postingSource(Buffer.from(input.upload.contentBase64,'base64').toString('utf8'));
 const batch=await prepareBooksBatch(orders,target.readExisting);const prepared:ZohoPreparedDraft[]=[];for(const row of batch.rows)if(row.action!=='skip'){const proposal=await target.prepareDraft(structuredClone(row));checkPrepared(proposal,row,identity);prepared.push(structuredClone(proposal));}for(const row of batch.rows)if(row.action!=='skip')postingHistory(deps.store.read(),venture.id,postingSubject(target,row.externalId,'draft'));
 check(batch.rows.every(row=>row.postingDate>=input.cycle.from&&row.postingDate<=input.cycle.to),'BOOKS_CYCLE_INVALID','Every posting date must belong to this cycle.');
 return ventureAction(deps,ctx,'approve','books.stage',tx=>{
  check(source(tx.state,venture.id,b).digest===input.digest&&target.identity===identity,'BOOKS_SOURCE_CHANGED','The source or connection changed while checking the books.');
  const base=tx.base('venture-books-posting'),values=batch.rows.map(row=>row.action==='skip'?'0':String(BigInt(row.totalMinor)*(row.action==='create-refund-draft'?-1n:1n)));
  const figures=[{key:'total',label:'Net draft amount',minor:batch.totalMinor,display:formatMinor(batch.totalMinor,'INR'),currency:'INR',unit:'money' as const},...batch.rows.map((row,index)=>({key:row.externalId,label:'Draft amount: '+row.orderId,minor:values[index]!,display:formatMinor(values[index]!,'INR'),currency:'INR',unit:'money' as const}))];
  const proof:WorkReceiptRecord={...tx.base('venture-work-receipt'),operation:'work.totals',runRef:{kind:'delivery',runId:base.id},currency:'INR',inputs:{tables:[{id:input.upload.id,name:input.upload.name,digest:input.digest}],columns:{totalMinor:'totalMinor'},rowIds:batch.rows.map(row=>row.orderId)},steps:[{op:'add',inputs:values,result:batch.totalMinor,rule:'Sum proposed drafts in paise; refund drafts subtract and skipped orders contribute zero.'}],figures,reconciliation:null,allowedNumbers:figures.flatMap(row=>[row.minor,row.display]),explanation:'Source totals are checked before this dry run. Creating drafts does not issue or send them.',digest:''};proof.digest=digest({...proof,digest:''});tx.put(proof);
  const record=seal({...base,clientId:input.order.clientId,orderId:input.order.id,cycleId:input.cycle.id,entry:{kind:'posting',uploadId:input.upload.id,sourceDigest:input.digest,target:identity,prepared,batch,state:'staged',outcomes:batch.rows.filter(row=>row.action!=='skip').map(row=>({externalId:row.externalId,state:'pending',remoteId:null})),receiptId:proof.id,reviewDigest:''}});tx.put(record);tx.emit('desk.changed',{playbook:'bookkeeping-cfo',kind:'finance',id:record.id});return record;
 });
}
/** Each visible row gets its own durable claim. Unknown outcomes stop the remaining rows. */
export async function applyBooksPosting(deps:VentureDeps,ctx:Context,target:BooksTarget,raw:unknown):Promise<PostingRecord>{
 requireAppChannel(ctx,'venture.desk.act');authorize(deps.store,ctx,'approve');const b=exactPayload(raw,['id','digest'],['id','digest']) as {id:string;digest:string};let row=unchanged(deps,ctx,target,current(deps,ctx,b.id));
 check(row.entry.state==='staged'&&row.entry.reviewDigest===b.digest,'APPROVAL_STALE','Review a fresh accounting dry run.');
 const {state,venture}=readVenture(deps,ctx),input=source(state,venture.id,{orderId:row.orderId,uploadId:row.entry.uploadId},row.cycleId);
 const live=await prepareBooksBatch(postingSource(Buffer.from(input.upload.contentBase64,'base64').toString('utf8')),target.readExisting);row=unchanged(deps,ctx,target,row);check(row.entry.state==='staged'&&row.entry.reviewDigest===b.digest&&live.digest===row.entry.batch.digest,'APPROVAL_STALE','The accounting records changed. Prepare a new dry run.');
 row=await save(deps,ctx,row.id,entry=>{check(entry.state==='staged'&&entry.reviewDigest===b.digest,'APPROVAL_STALE','This dry run is already being applied.');return {...entry,state:'applying'};});
 try{for(const decision of row.entry.batch.rows.filter(value=>value.action!=='skip')){
  postingHistory(deps.store.read(),row.ventureId,postingSubject(target,decision.externalId,'draft'));const prepared=row.entry.prepared.find(value=>value.decision.externalId===decision.externalId);check(prepared,'APPROVAL_STALE','This dry run lacks its exact provider request.');checkPrepared(prepared,decision,target.identity);const fresh=await target.prepareDraft(structuredClone(decision));checkPrepared(fresh,decision,target.identity);check(fresh.digest===prepared.digest,'APPROVAL_STALE','The provider mapping changed. Review a new dry run.');const actionDigest=digest({review:b.digest,decision,prepared,target:target.identity});let remoteId:string|null=null;
  const done=await journalled(deps,ctx,{action:'connector.write',subject:postingSubject(target,decision.externalId,'draft'),target:target.identity,account:target.identity,operation:'books-draft',actionDigest,line:'Create the exact reviewed accounting draft '+decision.externalId,descriptionComplete:false},async handle=>{
   let sent=false;const beforeSend=()=>{check(!sent,'BOOKS_ALREADY_SENT','This accounting action was already sent.');const now=unchanged(deps,ctx,target,row);check(now.entry.state==='applying','APPROVAL_STALE','This accounting run is no longer active.');postingHistory(deps.store.read(),row.ventureId,postingSubject(target,decision.externalId,'draft'),handle.entry.id);handle.fence(target.identity);gateEffect({name:'books.draft',digest:actionDigest},sealApproval(handle.entry,actionDigest));sent=true;};
   try{await target.createDraft(structuredClone(prepared),beforeSend);check(sent,'BOOKS_WRITE_UNCONFIRMED','The adapter did not send the approved action.');const found=await target.readExisting([decision.externalId]);if(found.length===1&&matches(decision,found[0],'draft',prepared)){remoteId=found[0]!.id;return {outcome:'applied',line:'The exact draft was read back. It was not issued.',value:true,receiptId:row.entry.receiptId};}}
   catch{if(!sent)return {outcome:'not-sent',line:'The accounting action stopped before sending.',value:false};}
   return {outcome:'unknown',line:'Check the client books. This draft may exist and will not be retried.',value:false};
  },{account:target.identity});
  const confirmed=done.entry.state==='applied';row=await save(deps,ctx,row.id,entry=>({...entry,state:confirmed?'applying':done.entry.state==='outcome_unknown'?'outcome_unknown':'stopped',outcomes:entry.outcomes.map(value=>value.externalId===decision.externalId?{...value,state:confirmed?'drafted':done.entry.state==='outcome_unknown'?'outcome_unknown':'not-sent',remoteId}:value)}));if(!confirmed)return row;
 }
 return await save(deps,ctx,row.id,entry=>({...entry,state:'drafted'}));
 }catch(error){await reconcileBooksPosting(deps,ctx,row.id).catch(()=>{});throw error;}
}
/** Reconnect completed drafts only after exact readback. Historical prepared bytes stay immutable. */
export async function refreshBooksConnection(deps:VentureDeps,ctx:Context,target:BooksTarget,raw:unknown):Promise<PostingRecord>{
 requireAppChannel(ctx,'venture.desk.act');authorize(deps.store,ctx,'approve');const b=exactPayload(raw,['id','digest'],['id','digest']) as {id:string;digest:string};const row=current(deps,ctx,b.id);
 check(row.entry.state==='drafted'&&row.entry.reviewDigest===b.digest&&row.entry.outcomes.length>0&&row.entry.outcomes.every(value=>value.state==='drafted'||value.state==='issued'),'APPROVAL_STALE','Only completed, confirmed drafts can reconnect for a separate issue approval.');
 // Preserve the former identity solely for validating this stored proposal and its current source.
 unchanged(deps,ctx,{...target,identity:row.entry.target},row);
 const decisions=row.entry.batch.rows.filter(value=>value.action!=='skip'),ids=decisions.map(value=>value.externalId);check(decisions.length===row.entry.outcomes.length,'APPROVAL_STALE','Every draft needs its recorded outcome.');
 const found=await target.readExisting(ids);validateBooksExisting(found,new Set(ids));
 check(found.length===decisions.length&&decisions.every(decision=>{const outcome=row.entry.outcomes.find(value=>value.externalId===decision.externalId),remote=found.find(value=>value.externalId===decision.externalId);return outcome&&remote?.id===outcome.remoteId&&matches(decision,remote,outcome.state==='issued'?'issued':'draft',row.entry.prepared.find(value=>value.decision.externalId===decision.externalId));}),'APPROVAL_STALE','The accounting drafts changed. Check the client books before reconnecting this work.');
 check(unchanged(deps,ctx,{...target,identity:row.entry.target},row).entry.reviewDigest===b.digest,'APPROVAL_STALE','This work changed during the account check.');
 return save(deps,ctx,row.id,entry=>{check(entry.state==='drafted'&&entry.reviewDigest===b.digest,'APPROVAL_STALE','This work changed during the account check.');return {...entry,target:target.identity};});
}
/** Issuing is a new exact owner action, never part of draft creation. No email is authorized. */
export async function issueBooksPosting(deps:VentureDeps,ctx:Context,target:BooksTarget,raw:unknown):Promise<PostingRecord>{
 requireAppChannel(ctx,'venture.desk.act');authorize(deps.store,ctx,'approve');const b=exactPayload(raw,['id','digest','externalId'],['id','digest','externalId']) as {id:string;digest:string;externalId:string};const row=unchanged(deps,ctx,target,current(deps,ctx,b.id));
 const decision=row.entry.batch.rows.find(value=>value.externalId===b.externalId&&value.action!=='skip'),outcome=row.entry.outcomes.find(value=>value.externalId===b.externalId);
 check(row.entry.state==='drafted'&&row.entry.reviewDigest===b.digest&&decision&&outcome?.state==='drafted','APPROVAL_STALE','Review the exact draft before issuing.');
 const existing=await target.readExisting([b.externalId]);check(existing.length===1&&existing[0]!.id===outcome.remoteId&&matches(decision,existing[0],'draft',row.entry.prepared.find(value=>value.decision.externalId===decision.externalId)),'APPROVAL_STALE','The accounting draft changed before issue.');
 check(unchanged(deps,ctx,target,row).entry.reviewDigest===b.digest,'APPROVAL_STALE','This accounting work changed.');
 postingHistory(deps.store.read(),row.ventureId,postingSubject(target,b.externalId,'issue'));const actionDigest=digest({review:b.digest,externalId:b.externalId,target:target.identity});
 const claiming=await save(deps,ctx,row.id,entry=>{check(entry.reviewDigest===b.digest&&entry.state==='drafted','APPROVAL_STALE','This draft changed before issue.');return {...entry,state:'issuing',outcomes:entry.outcomes.map(value=>value.externalId===b.externalId?{...value,state:'issuing'}:value)};});
 try{const done=await journalled(deps,ctx,{action:'connector.write',subject:postingSubject(target,b.externalId,'issue'),target:target.identity,account:target.identity,operation:'books-issue',actionDigest,line:'Issue the exact reviewed accounting draft '+b.externalId,descriptionComplete:false},async handle=>{
  let sent=false;try{await target.issue(existing[0]!,()=>{check(!sent,'BOOKS_ALREADY_SENT','This issue was already sent.');check(unchanged(deps,ctx,target,row).entry.reviewDigest===claiming.entry.reviewDigest,'APPROVAL_STALE','This draft changed before issue.');postingHistory(deps.store.read(),row.ventureId,postingSubject(target,b.externalId,'issue'),handle.entry.id);handle.fence(target.identity);gateEffect({name:'books.issue',digest:actionDigest,touches:['issue']},sealApproval(handle.entry,actionDigest));sent=true;});check(sent,'BOOKS_WRITE_UNCONFIRMED','The adapter did not send the issue.');const found=await target.readExisting([b.externalId]);if(found.length===1&&found[0]!.id===outcome.remoteId&&matches(decision,found[0],'issued',row.entry.prepared.find(value=>value.decision.externalId===decision.externalId)))return {outcome:'applied',line:'The issued document was read back. No email was sent.',value:true,receiptId:row.entry.receiptId};}catch{if(!sent)return {outcome:'not-sent',line:'Issuing stopped before sending.',value:false};}
  return {outcome:'unknown',line:'Issuing could not be confirmed. Check the client books before any further action.',value:false};
 },{account:target.identity});
 return await save(deps,ctx,row.id,entry=>({...entry,state:done.entry.state==='applied'?'drafted':done.entry.state==='outcome_unknown'?'outcome_unknown':'stopped',outcomes:entry.outcomes.map(value=>value.externalId===b.externalId?{...value,state:done.entry.state==='applied'?'issued':done.entry.state==='outcome_unknown'?'outcome_unknown':'drafted'}:value)}));
 }catch(error){await reconcileBooksPosting(deps,ctx,row.id).catch(()=>{});throw error;}
}
