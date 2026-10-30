// SEO5 metadata. seo-agent MIT ideas; JSON-LD reuses 5A5. Lengths are house bounds, not Google's limits.
import {jsonLdScript,type JsonLdNode} from '../kit/jsonld-core.ts';
import {seoText} from './content-core.ts';
export const META_BOUNDS={checkedOn:'2026-10-27',read:'house',title:{min:20,max:65},description:{min:70,max:160}} as const;
/** Complete sentence and length checks never promise a search appearance. */
export function checkMeta(input:{title:string;description:string;jsonld:JsonLdNode|null}) {
 const checks=(['title','description'] as const).map(key=>{const text=seoText(input[key],5000).trim(),bounds=META_BOUNDS[key];return {id:key,pass:[...text].length>=bounds.min&&[...text].length<=bounds.max&&/[.!?\u0964]$/.test(text)&&!/[<>\r\n]/.test(text),length:[...text].length,min:bounds.min,max:bounds.max};});
 return {pass:checks.every(c=>c.pass),checks,jsonld:input.jsonld===null?null:jsonLdScript(input.jsonld),bounds:META_BOUNDS,limits:'Our length and sentence rules. Google may show a different title or snippet.'};
}
