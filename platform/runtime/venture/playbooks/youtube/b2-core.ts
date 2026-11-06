// Chausar 5B2 browser-safe validation, original code; no outside source copied.
export function requireValue(value:unknown,code:string,line:string):asserts value {if(!value)throw Object.assign(new Error(line),{name:'ChausarError',code});}
export const bounded=(value:unknown,min:number,max:number)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
export const wordsOf=(text:string)=>text.trim().split(/\s+/u).filter(Boolean);
export type Finding={id:string;outcome:'pass'|'fail'|'not-run';detail:string};
export const xmlEscape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
