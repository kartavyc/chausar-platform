// Tender evidence is read from current same-order bytes, never caller supplied digests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTenderSources,requireTenderSources} from '../runtime/venture/playbooks/tender-desk/sources.ts';
const fixture=()=>{
 const order={id:'order_1',clientId:'client_1',status:'open',intake:{fields:{rfpText:'Describe your company.'}}};
 const file={id:'upload_1',name:'company.txt',format:'csv',scope:{kind:'order',orderId:'order_1'},contentBase64:Buffer.from('We provide local services.').toString('base64'),digest:'unchanged'};
 const find=(kind:string,id:string)=>kind==='venture-order'&&id===order.id?order:kind==='venture-upload'&&id===file.id?file:undefined;
 return {order,file,read:{find} as any,deps:{host:'test'} as any,selection:{rfpFileId:null,documentFileIds:['upload_1'],issuerFileId:null,mapping:null}};
};
test('tender bucket reads actual source bytes and rejects changed bytes even with the same stored digest',async()=>{
 const f=fixture(),source=await loadTenderSources(f.deps,f.read,'order_1',f.selection);
 assert.equal(source.rfpText,'Describe your company.');assert.equal(source.documents[0].text,'We provide local services.');
 await requireTenderSources(f.deps,f.read,'order_1',f.selection,source.digest);
 f.file.contentBase64=Buffer.from('A different source.').toString('base64');
 await assert.rejects(requireTenderSources(f.deps,f.read,'order_1',f.selection,source.digest),{code:'DERIVED_STALE'});
});
test('foreign-order files, missing evidence, cancelled orders and changed clients cannot back tender answers',async()=>{
 const f=fixture();f.file.scope.orderId='other_order';
 await assert.rejects(loadTenderSources(f.deps,f.read,'order_1',f.selection),{code:'TENDER_SOURCE_REQUIRED'});
 f.file.scope.orderId=f.order.id;
 const source=await loadTenderSources(f.deps,f.read,'order_1',f.selection);
 f.order.clientId='other_client';await assert.rejects(requireTenderSources(f.deps,f.read,'order_1',f.selection,source.digest),{code:'DERIVED_STALE'});
 f.order.status='cancelled';await assert.rejects(loadTenderSources(f.deps,f.read,'order_1',f.selection),{code:'ORDER_NOT_FOUND'});
});
