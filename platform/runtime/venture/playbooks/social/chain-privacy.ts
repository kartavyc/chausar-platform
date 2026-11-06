// Original Chausar privacy cleanup for copied social writing evidence and its pending authority.
import type {VentureTx} from '../../records.ts';
import {removeRecords} from '../../network/people.ts';
export function eraseSocialChainNaming(tx:VentureTx,handles:ReadonlySet<string>,mentions:(text:unknown)=>boolean):void{
 const named=(text:string)=>mentions(text)||[...handles].some(handle=>handle.length>=3&&text.toLowerCase().includes(handle.toLowerCase()));
 const orders=tx.list('venture-order').filter(order=>order.socialChain),ids=new Set(orders.map(order=>order.id)),affected=new Set<string>(),uploads=new Set<string>();
 for(const order of orders)if(named(order.socialChain!.voice?.text??'')||named(order.request)||named(JSON.stringify(order.socialGhostwriting?.decisions??{})))affected.add(order.id);
 for(const file of tx.list('venture-upload')){if((file.scope.kind!=='order'&&file.scope.kind!=='media')||!ids.has(file.scope.orderId))continue;if(named(file.name)||named(Buffer.from(file.contentBase64??'','base64').toString('utf8'))){uploads.add(file.id);affected.add(file.scope.orderId);}}
 const runs=tx.list('venture-delivery-run').filter(run=>ids.has(run.orderId));
 for(const run of runs)if(named(JSON.stringify(run)))affected.add(run.orderId);
 for(const receipt of tx.list('venture-work-receipt'))if(receipt.operation==='social.report'&&receipt.runRef.kind==='delivery'&&named(JSON.stringify(receipt))){const id=receipt.runRef.runId;const run=runs.find(run=>run.id===id);if(run)affected.add(run.orderId);}
 if(!affected.size)return;
 const runIds=new Set(runs.filter(run=>affected.has(run.orderId)).map(run=>run.id));
 for(const order of orders)if(affected.has(order.id)){tx.replace({...order,...(named(order.request)?{request:'This request was erased because it named someone you asked Chausar to forget.'}:{}),socialChain:{...order.socialChain!,voice:null},chainStage:1,chainState:'running',chainSince:tx.now,socialPostHistory:[],...(order.socialGhostwriting?{socialGhostwriting:{...order.socialGhostwriting,decisions:{}}}:{})});tx.emit('chain.changed',{});}
 for(const run of runs)if(runIds.has(run.id)){const {judge:_judge,...rest}=run;tx.replace({...rest,status:'stopped',callId:null,preview:null,deliverable:null,renderedText:null,editedText:null,checks:[],playbookChecks:[],...(run.socialGhostwriting?{socialGhostwriting:{...run.socialGhostwriting,decisions:{}}}:{}),harness:null,verdict:null});tx.emit('run.stopped',{runId:run.id});}
 removeRecords(tx,record=>record.kind==='venture-upload'&&uploads.has(String(record.id))||record.kind==='venture-work-receipt'&&typeof record.runRef==='object'&&record.runRef!==null&&'runId'in record.runRef&&runIds.has(String(record.runRef.runId))||record.kind==='venture-share-link'&&runIds.has(String(record.deliveryId)));
}
