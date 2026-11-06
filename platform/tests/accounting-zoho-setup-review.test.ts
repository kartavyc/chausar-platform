// Independent provider review uses the documented root-shaped GET account response.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createZohoSetupAdapter} from '../runtime/adapters/accounting/zoho-setup.ts';
import type {PinnedSender} from '../runtime/venture/core/net-guard.ts';
const config={dataCenter:'in' as const,organizationId:'12345',accessToken:'review session fixture',revision:'review'};
test('an exact account readback accepts documented root fields and refuses a wrong organization',async()=>{
 const input={kind:'account' as const,sourceId:'source',name:'Reserve',code:'RESERVE',accountType:'cash' as const,currencyId:'66'};let other=false;
 const send:PinnedSender=async target=>{const path=target.url.pathname;const value=path.endsWith('/organizations/12345')?{organization:{organization_id:'12345',currency_id:'66',currency_code:'INR',price_precision:2,is_org_active:true,address:{country:'India'}}}:path.endsWith('/chartofaccounts')?{chartofaccounts:[{account_id:'11'}],page_context:{has_more_page:false}}:{account_id:'11',organization_id:other?'999':'12345',account_name:'Reserve',account_code:'RESERVE',account_type:'cash',currency_id:'66',currency_code:'INR',is_active:true};return {status:200,headers:{},body:Buffer.from(JSON.stringify({code:0,...value}))};};
 const adapter=createZohoSetupAdapter(config,{resolve:async()=>[{address:'93.184.216.34',family:4}],send});assert.equal((await adapter.readMaster(input))?.id,'11');other=true;await assert.rejects(adapter.readMaster(input),{code:'BOOKS_READ_FAILED'});
});
