// Original R2 mapping and sensitive-action gate. Qwen-CUA/JobOS (Apache-2.0) informed the boundary; no upstream code copied.
import {check} from '../../../portable.ts';
import type {FormTarget,FormMappedValue} from './types.ts';
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function need(ok:unknown):asserts ok{check(ok,'FORM_MAPPING_INVALID','Use unique source columns and current visible form fields.');}

/** A hold is never an authorization. Only the journalled exact owner decision may release a submit. */
export function formActionGate(input:{target:unknown;action:unknown}):'fill'|'hold'{
 const t=input.target;if(!object(t)||t.disabled!==false||typeof t.name!=='string')return 'hold';
 if(/password|passcode|\botp\b|\bcvv\b|card\s*number|security\s*code|authentication/i.test(t.name))return 'hold';
 if(input.action!=='type'||!['text','textarea','select','checkbox'].includes(String(t.kind)))return 'hold';
 return typeof t.kind==='string'?'fill':'hold';
}

/** Copy approved source strings without inference, formatting or reconstruction of masked data. */
export function mapFormRecord(input:unknown):FormMappedValue[]{
 need(object(input)&&Object.keys(input).sort().join(',')==='fields,mapping,pageHash,source');
 const x=input as Record<string,unknown>;need(object(x.source)&&Object.keys(x.source).length>0&&Object.keys(x.source).length<=100&&hash(x.pageHash));
 const source=x.source as Record<string,unknown>;
 need(Object.entries(source).every(([key,value])=>key.length>0&&key.length<=120&&!['__proto__','constructor','prototype'].includes(key)&&typeof value==='string'&&value.length<=4000));
 need(Array.isArray(x.fields)&&x.fields.length>0&&x.fields.length<=100&&Array.isArray(x.mapping)&&x.mapping.length>0&&x.mapping.length<=100);
 const fields=x.fields as unknown[];const targets=new Map<string,FormTarget>();
 for(const field of fields){need(object(field)&&Object.keys(field).sort().join(',')==='disabled,fingerprint,id,inForm,kind,name,pageHash'&&id(field.id)&&hash(field.fingerprint)&&hash(field.pageHash)&&typeof field.name==='string'&&field.name.length<=200&&typeof field.disabled==='boolean'&&typeof field.inForm==='boolean'&&typeof field.kind==='string');need(!targets.has(field.id as string));targets.set(field.id as string,field as FormTarget);}
 const used=new Set<string>();const columns=new Set<string>();const result:FormMappedValue[]=[];
 for(const mapping of x.mapping as unknown[]){need(object(mapping)&&Object.keys(mapping).sort().join(',')==='column,targetId'&&typeof mapping.column==='string'&&id(mapping.targetId));const m=mapping as {column:string;targetId:string};need(Object.hasOwn(source,m.column)&&!used.has(m.targetId)&&!columns.has(m.column));const field=targets.get(m.targetId);need(field);check(field!.pageHash===x.pageHash,'FORM_TARGET_CHANGED','The page changed. Capture the current form and approve its mapping again.');check(formActionGate({target:field,action:'type'})==='fill','FORM_ACTION_HELD','The owner must handle this control. Chausar does not type secrets or release a submit from a mapping.');used.add(m.targetId);columns.add(m.column);result.push({targetId:m.targetId,fingerprint:field!.fingerprint,pageHash:field!.pageHash,value:source[m.column] as string});}
 return result;
}
