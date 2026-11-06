// Chausar seller code prerequisites. Original integration; Sorftime/commerce MIT ideas only.
import {newId,check,type Context,type State} from '../../../contracts.ts';
import type {Json,OrderRecord,PlaybookRecord,VentureDeps,VentureRecord,WorkReceiptRecord} from '../../contracts.ts';
import type {FileLike} from '../../delivery/harness/files.ts';
import {buildToolEnv} from '../../delivery/harness/env.ts';
import {ONLINE_SELLER_TOOLS} from '../../delivery/harness/tools-online-seller.ts';
export const SELLER_PREPARE_TOOLS={'product-research':'seller.shortlist','catalogue-upload':'seller.catalogueSheet','multi-store-report':'seller.multiStore'} as const;
/** These reports must compute their sourced evidence before asking a model to describe it. */
export async function prepareSellerReport(deps:VentureDeps,ctx:Context,state:State,venture:VentureRecord,playbook:PlaybookRecord,order:OrderRecord,offerKey:string|null,files:FileLike[]):Promise<{runId:string;receipts:WorkReceiptRecord[];result:Json;tool:(typeof SELLER_PREPARE_TOOLS)[keyof typeof SELLER_PREPARE_TOOLS]}|null>{
 if(playbook.flagship!=='online-seller'||!offerKey||!Object.hasOwn(SELLER_PREPARE_TOOLS,offerKey))return null;
 const tool=SELLER_PREPARE_TOOLS[offerKey as keyof typeof SELLER_PREPARE_TOOLS];const sourceId=order.intake?.fields?.exports,index=files.findIndex(file=>file.id===sourceId);
 check(index>=0,'SELLER_INPUT_INVALID','Add the original seller export to this order.');
 const runId=newId('delivery');const env=buildToolEnv({deps,ctx,state,venture,playbook,runRef:{kind:'delivery',runId},files,allowed:[],intake:order.intake});
 const result=await ONLINE_SELLER_TOOLS[tool].run(env,{file:'f'+(index+1)});return {runId,receipts:result.receipts??[],result:result.result as Json,tool};
}
