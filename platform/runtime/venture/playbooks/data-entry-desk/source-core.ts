// Original bounded CSV source. Credentials are entered by the owner in the browser, never uploaded for the agent.
import {check,digest} from '../../../portable.ts';
import {csvRows} from '../../../csv.ts';
export type FormsSource={columns:string[];rows:Record<string,string>[];digest:string};
export function formSource(text:unknown):FormsSource{
 const need=(ok:unknown)=>check(ok,'FORM_SOURCE_INVALID','Use a bounded client CSV with unique columns and no passwords or access codes.');
 need(typeof text==='string'&&text.length>0&&text.length<=500000);
 let parsed:string[][];try{parsed=csvRows(text as string);}catch{need(false);throw new Error('unreachable');}
 const columns=parsed.shift()??[];need(columns.length>0&&columns.length<=100&&new Set(columns).size===columns.length&&columns.every(name=>name.trim()===name&&name.length>0&&name.length<=120&&!['__proto__','constructor','prototype'].includes(name)&&!/password|passcode|one[- ]time[- ]code|\botp\b|\bcvv\b|card\s*number|security\s*code|access[- ]token|api[- ]key|authentication/i.test(name)));
 need(parsed.length>0&&parsed.length<=200);
 const rows=parsed.map(cells=>{need(cells.length===columns.length&&cells.every(value=>value.length<=4000));return Object.fromEntries(columns.map((column,index)=>[column,cells[index]!]));});
 return {columns,rows,digest:digest({columns,rows})};
}
/** The owner picks the client's stable record-ID column. Row numbers never become outside-effect identities. */
export function chooseFormRow(text:unknown,identityColumn:unknown,rowIndex:unknown){
 const source=formSource(text);
 check(typeof identityColumn==='string'&&source.columns.includes(identityColumn)&&typeof rowIndex==='number'&&Number.isSafeInteger(rowIndex)&&rowIndex>=0&&rowIndex<source.rows.length,'FORM_SOURCE_INVALID','Choose the client record-ID column and an existing source row.');
 const ids=source.rows.map(row=>row[identityColumn]!);
 check(ids.every(id=>id.trim().length>0&&id.length<=200)&&new Set(ids).size===ids.length,'FORM_SOURCE_INVALID','Each source row needs a unique client record ID.');
 const values=source.rows[rowIndex]!;
 return {columns:source.columns,values,sourceRecordId:ids[rowIndex]!,rowDigest:digest(values),sourceDigest:source.digest,totalRows:source.rows.length};
}
