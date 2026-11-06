// Browser-safe SEO evidence files use a valid single-cell CSV, so the normal upload reader can read them too.
import {csvRows} from '../../../csv.ts';
import {seoNeed} from './content-core.ts';
/** Encode an owner reviewed evidence object in a normal UTF-8 CSV file. */
export function seoManifestCsv(value:unknown):string{const json=JSON.stringify(value);seoNeed(typeof json==='string'&&json.length<=900000,'SEO_INPUT_INVALID','Use a bounded evidence object.');return 'seo_manifest\n"'+json.replaceAll('"','""')+'"\n';}
/** Read either an uploaded manifest CSV or a direct bounded JSON tool fixture. */
export function readSeoManifest(text:string):any{seoNeed(text.length<=1000000,'SEO_INPUT_INVALID','Use an evidence file below one megabyte.');let value:unknown;try{if(text.trimStart().startsWith('{'))value=JSON.parse(text);else{const rows=csvRows(text);if(rows.length!==2||rows[0]?.length!==1||rows[0]?.[0]!=='seo_manifest'||rows[1]?.length!==1)throw Error('shape');value=JSON.parse(rows[1][0]!);}}catch{throw Object.assign(new Error('Upload a valid JSON evidence manifest.'),{code:'SEO_INPUT_INVALID'});}seoNeed(value&&typeof value==='object'&&!Array.isArray(value),'SEO_INPUT_INVALID','Give an evidence object.');return value;}
/** Refresh accepts the GSC export alone, or the same export beside explicit owner-recorded gaps. */
export function readRefreshSource(text:string):{csv:string;gaps:string[];missingAi:string[]}{
 if(!text.trimStart().startsWith('{')&&!text.trimStart().startsWith('seo_manifest'))return {csv:text,gaps:[],missingAi:[]};
 const value=readSeoManifest(text);seoNeed(Object.keys(value).every(k=>['csv','gaps','missingAi'].includes(k))&&typeof value.csv==='string'&&Array.isArray(value.gaps)&&Array.isArray(value.missingAi),'GSC_EXPORT_INVALID','Give the Search Console export and the recorded content and AI-answer gaps.');return value;
}
