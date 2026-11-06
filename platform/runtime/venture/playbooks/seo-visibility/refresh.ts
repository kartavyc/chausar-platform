// SEO6 GSC refresh plans. loamwright Apache-2.0 ideas; independent code over owner exports.
import {csvRows} from '../../../csv.ts';
import {seoNeed,seoText} from './content-core.ts';
export type RefreshRow={query:string;pages:string[];signal:string;action:'title-meta'|'depth-rewrite'|'new-article'|'consolidate'|'ai-overview'};
/** Strict CSV parsing and code routing produce advice only, never a live change. */
export function refreshPlan(input:{csv:string;gaps:string[];missingAi:string[]}) {
 seoText(input.csv,1000000);seoNeed(Array.isArray(input.gaps)&&input.gaps.length<=100&&Array.isArray(input.missingAi)&&input.missingAi.length<=100,'GSC_EXPORT_INVALID','Give at most one hundred recorded gaps.');
 const rows=csvRows(input.csv),header=rows.shift()?.map(s=>s.trim().toLowerCase())??[];const keys=['query','page','clicks','impressions','position'];seoNeed(keys.every(key=>header.includes(key))&&new Set(header).size===header.length&&rows.length<=10000,'GSC_EXPORT_INVALID','Upload a Search Console CSV with Query, Page, Clicks, Impressions and Position.');
 const at=(row:string[],key:string)=>row[header.indexOf(key)]?.trim()??'';const plan:RefreshRow[]=[];const grouped=new Map<string,Set<string>>();
 for(const row of rows){if(row.every(v=>!v.trim()))continue;const query=at(row,'query'),page=at(row,'page'),clicks=Number(at(row,'clicks')),impressions=Number(at(row,'impressions')),position=Number(at(row,'position'));seoNeed(row.length===header.length&&query.length>0&&query.length<=500&&/^https?:\/\//.test(page)&&/^\d+$/.test(at(row,'clicks'))&&/^\d+$/.test(at(row,'impressions'))&&Number.isSafeInteger(clicks)&&Number.isSafeInteger(impressions)&&clicks<=impressions&&Number.isFinite(position)&&position>0,'GSC_EXPORT_INVALID','A Search Console row has missing or invalid evidence.');
 const pages=grouped.get(query)??new Set<string>();pages.add(page);grouped.set(query,pages);
 if(position<=10&&impressions>=50&&clicks/impressions<.02)plan.push({query,pages:[page],signal:'On page one, with few clicks under our two-percent house threshold.',action:'title-meta'});
 if(position>=11&&position<=20&&impressions>=100)plan.push({query,pages:[page],signal:'On page two with at least one hundred impressions.',action:'depth-rewrite'});
 }
 for(const [query,pages]of grouped)if(pages.size>1)plan.push({query,pages:[...pages],signal:'Multiple pages share this query; inspect overlap.',action:'consolidate'});
 for(const query of input.gaps){seoText(query,500);plan.push({query,pages:[],signal:'A recorded content gap.',action:'new-article'});}for(const query of input.missingAi){seoText(query,500);plan.push({query,pages:[],signal:'Absent from the recorded AI answer panel.',action:'ai-overview'});}
 return {kind:'plan-only' as const,rows:plan,sourceRows:rows.length,limits:'House routing thresholds, not a ranking forecast. Review each plan before commissioning work.'};
}
