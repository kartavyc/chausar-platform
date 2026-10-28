// Exact integer controls for counts and indexes. Money never uses this parser.
import {check} from '../../../contracts.ts';
export function wholeCount(value:unknown):number{
 check(typeof value==='number'||typeof value==='string'&&/^\d{1,16}$/.test(value),'TOOL_FAILED','Use a whole, non-negative count.');
 const count=typeof value==='number'?value:parseInt(value,10);
 check(Number.isSafeInteger(count)&&count>=0,'TOOL_FAILED','Use a whole count within the supported range.');return count;
}
