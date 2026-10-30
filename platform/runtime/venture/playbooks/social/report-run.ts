// Validate supported report sources before an agent reads client data.
import {check} from '../../../contracts.ts';
import type {OrderRecord} from '../../contracts.ts';
import type {FileLike} from '../../delivery/harness/files.ts';
import {csvRows} from '../../../csv.ts';
/** Validate exact supported sources before any client data reaches an agent. */
export function socialReportSources(order:OrderRecord,files:FileLike[]){
 const month=order.intake?.fields?.reportMonth;check(typeof month==='string'&&/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month),'SOCIAL_REPORT_MONTH_REQUIRED','Choose the export month as YYYY-MM.');
 check(files.length>0&&files.length<=2,'SOCIAL_EXPORTS_REQUIRED','Add one supported CSV export per platform before writing the report.');
 const entries=files.map((file,i)=>{check(file.format==='csv','SOCIAL_EXPORTS_REQUIRED','Add the original Instagram or LinkedIn CSV export.');let header:string[]=[];try{header=csvRows(Buffer.from(file.contentBase64,'base64').toString('utf8'))[0]??[];}catch{check(false,'SOCIAL_EXPORTS_REQUIRED','The platform export CSV is malformed.');}const instagram=header.includes('Post ID')&&header.includes('Publish time'),linkedin=header.includes('Update link')&&header.includes('Created date');check(instagram!==linkedin,'SOCIAL_EXPORTS_REQUIRED','The export must have the exact headers of one supported platform.');return {file:'f'+(i+1),platform:instagram?'instagram':'linkedin'};});
 check(new Set(entries.map(entry=>entry.platform)).size===entries.length,'TOOL_FAILED','Add one export per platform.');
 return {month,entries};
}
