// Original Chausar S9, yominpost MIT source-tagging idea only.
import { requireSocial, socialDay, socialNumber } from './d2-core.ts';
import {csvRows} from '../../../csv.ts';
/** Null means check in the platform app, never an invented zero. Dates and counts come from code. */
export function accountHealth(input:{now:string;openedOn:string|null;followers:number|null;posts:{on:string;failed:boolean}[];source:'export'|'typed-by-you'}){
 requireSocial(socialDay(input.now)&&(input.openedOn===null||socialDay(input.openedOn)&&input.openedOn<=input.now)&&(input.followers===null||socialNumber(input.followers))&&['export','typed-by-you'].includes(input.source)&&Array.isArray(input.posts)&&input.posts.length<=10000);
 input.posts.forEach(row=>requireSocial(socialDay(row.on)&&row.on<=input.now&&typeof row.failed==='boolean'));const recent=input.posts.filter(row=>Date.parse(row.on)>Date.parse(input.now)-30*86400000);
 return {followers:{value:input.followers,source:input.followers===null?'check-in-app':input.source},accountAgeDays:{value:input.openedOn===null?null:Math.floor((Date.parse(input.now)-Date.parse(input.openedOn))/86400000),source:input.openedOn===null?'check-in-app':'derived'},posts30:{value:recent.length,source:'derived'},failures:{value:recent.filter(row=>row.failed).length,source:'derived'},inputSource:input.source};
}
/** An explicit owner export schema avoids treating a missing field as zero or silently choosing another metric. */
export function healthCsv(text:string,now:string){requireSocial(typeof text==='string'&&text.length<=1000000);let rows:string[][];try{rows=csvRows(text);}catch{requireSocial(false);}requireSocial(rows.length>=2&&rows[0]!.join(',')==='followers,openedOn,postDate,failed');const [followers,openedOn]=rows[1]!;requireSocial(followers!==undefined&&(/^\d+$/.test(followers)||followers==='')&&openedOn!==undefined);const posts=rows.slice(1).flatMap(row=>{requireSocial(row.length===4&&row[0]===followers&&row[1]===openedOn);if(row[2]===''&&row[3]==='')return [];requireSocial(row[3]==='true'||row[3]==='false');return [{on:row[2]!,failed:row[3]==='true'}];});return accountHealth({now,followers:followers===''?null:Number(followers),openedOn:openedOn||null,posts,source:'export'});}

/** Owner rows are exact: YYYY-MM-DD,posted or YYYY-MM-DD,failed. Typos never become a healthy event. */
export function ownerPostRows(text:string){requireSocial(typeof text==='string'&&text.length<=100000);if(!text.trim())return [];return text.split(/\r?\n/).map(line=>{const cells=line.split(',').map(cell=>cell.trim());requireSocial(cells.length===2&&socialDay(cells[0])&&['posted','failed'].includes(cells[1]??''),'SOCIAL_INPUT_INVALID','Use date,posted or date,failed for each post.');return {on:cells[0]!,failed:cells[1]==='failed'};});}
