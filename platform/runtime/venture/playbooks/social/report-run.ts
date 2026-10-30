// Report prerequisites are code work, never extra model turns. Original Chausar implementation.
import {randomUUID} from 'node:crypto';
import {check,type Context,type State} from '../../../contracts.ts';
import type {Json,OrderRecord,PlaybookRecord,VentureDeps,VentureRecord,WorkReceiptRecord} from '../../contracts.ts';
import type {FileLike} from '../../delivery/harness/files.ts';
import {csvRows} from '../../../csv.ts';
import {buildToolEnv} from '../../delivery/harness/env.ts';
import {SOCIAL_TOOLS} from '../../delivery/harness/tools-social.ts';
/** Exact supported export headers identify their platform; ambiguous and unknown sources are refused. */
export async function prepareSocialReport(deps:VentureDeps,ctx:Context,state:State,venture:VentureRecord,playbook:PlaybookRecord,order:OrderRecord,files:FileLike[]):Promise<{runId:string;receipts:WorkReceiptRecord[];result:Json}|null>{
 if(order.socialChain?.offerKey!=='monthly-report')return null;
 const month=order.intake?.fields?.reportMonth;check(typeof month==='string'&&/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month),'SOCIAL_REPORT_MONTH_REQUIRED','Choose the export month as YYYY-MM.');
 check(files.length>0&&files.length<=2,'SOCIAL_EXPORTS_REQUIRED','Add one supported CSV export per platform before writing the report.');
 const entries=files.map((file,i)=>{check(file.format==='csv','SOCIAL_EXPORTS_REQUIRED','Add the original Instagram or LinkedIn CSV export.');let header:string[]=[];try{header=csvRows(Buffer.from(file.contentBase64,'base64').toString('utf8'))[0]??[];}catch{check(false,'SOCIAL_EXPORTS_REQUIRED','The platform export CSV is malformed.');}const instagram=header.includes('Post ID')&&header.includes('Publish time'),linkedin=header.includes('Update link')&&header.includes('Created date');check(instagram!==linkedin,'SOCIAL_EXPORTS_REQUIRED','The export must have the exact headers of one supported platform.');return {file:'f'+(i+1),platform:instagram?'instagram':'linkedin'};});
 const runId='delivery_'+randomUUID();const env=buildToolEnv({deps,ctx,state,venture,playbook,runRef:{kind:'delivery',runId},files,allowed:[],intake:order.intake});
 const result=await SOCIAL_TOOLS['social.report'].run(env,{month,files:entries});return {runId,receipts:result.receipts??[],result:result.result as Json};
}
