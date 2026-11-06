// Original R2 saved-record comparison. Qwen-CUA (Apache-2.0) informed verified outcome words; no source code copied.
import {check} from '../../../portable.ts';
import type {FormReadback} from './types.ts';

/** Missing identity remains unverified. A difference is reported, never repaired or retried automatically. */
export function compareFormReadback(expected:readonly {targetId:string;value:string}[],readback:{recordId:string|null;fields:Record<string,string>}):FormReadback{
 check(Array.isArray(expected)&&expected.length>0&&expected.length<=100&&expected.every(row=>row&&typeof row.targetId==='string'&&row.targetId.length>0&&typeof row.value==='string')&&new Set(expected.map(row=>row.targetId)).size===expected.length,'FORM_MAPPING_INVALID','Compare a bounded list of unique mapped fields.');
 check(readback&&typeof readback==='object'&&!Array.isArray(readback)&&Object.keys(readback).sort().join(',')==='fields,recordId'&&(readback.recordId===null||typeof readback.recordId==='string'&&readback.recordId.length>0&&readback.recordId.length<=200)&&readback.fields&&typeof readback.fields==='object'&&!Array.isArray(readback.fields)&&Object.values(readback.fields).every(value=>typeof value==='string'&&value.length<=4000),'FORM_READBACK_INVALID','Read the saved record identity and exact field values.');
 const differences=expected.flatMap(row=>{const actual=Object.hasOwn(readback.fields,row.targetId)?readback.fields[row.targetId]:null;return actual===row.value?[]:[{targetId:row.targetId,expected:row.value,actual}];});
 return {status:readback.recordId===null?'not-checked':differences.length?'saved-differently':'matches',recordId:readback.recordId,differences};
}
