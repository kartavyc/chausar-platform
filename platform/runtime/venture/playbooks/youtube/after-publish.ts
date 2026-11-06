// Original Chausar decision table. dageno-agents workflow (no licence): idea only, no source copied.
import {check,researchCount,researchText,RESEARCH_INVALID} from './b3-core.ts';
export type StudioPerformance={videoId:string;ctrBasisPoints:number|null;retentionBasisPoints:number|null;searchViews:string|null;browseViews:string|null;views:string|null};
export type AfterPublishThresholds={lowCtrBasisPoints:number;highRetentionBasisPoints:number;trafficShareBasisPoints:number;source:'house'|'owner'};
export const AFTER_PUBLISH_DEFAULTS:Readonly<AfterPublishThresholds>=Object.freeze({lowCtrBasisPoints:400,highRetentionBasisPoints:5000,trafficShareBasisPoints:5000,source:'house'});
const ratio=(value:bigint|null,total:bigint|null)=>value===null||total===null||total===0n?null:Number(value*10000n/total);
/** One directive, ordered by packaging/opening evidence before traffic mix; no inference from missing counts. */
export function afterPublish(source:StudioPerformance,thresholds:AfterPublishThresholds={...AFTER_PUBLISH_DEFAULTS}){
 researchText(source.videoId);check(['house','owner'].includes(thresholds.source)&&Object.values(thresholds).filter(v=>typeof v==='number').length===3,RESEARCH_INVALID,'Choose the house thresholds or explicit owner thresholds.');
 for(const key of ['lowCtrBasisPoints','highRetentionBasisPoints','trafficShareBasisPoints'] as const)check(Number.isSafeInteger(thresholds[key])&&thresholds[key]>0&&thresholds[key]<10000,RESEARCH_INVALID,'Thresholds must be between zero and one hundred percent.');
 check(thresholds.source!=='house'||Object.keys(AFTER_PUBLISH_DEFAULTS).every(key=>thresholds[key as keyof AfterPublishThresholds]===AFTER_PUBLISH_DEFAULTS[key as keyof AfterPublishThresholds]),RESEARCH_INVALID,'Changed thresholds must be labelled owner-set.');
 for(const value of [source.ctrBasisPoints,source.retentionBasisPoints])check(value===null||Number.isSafeInteger(value)&&value>=0&&value<=10000,RESEARCH_INVALID,'Use measured percentages in whole hundredths, or mark them missing.');
 const total=researchCount(source.views),search=researchCount(source.searchViews),browse=researchCount(source.browseViews);
 check(total===null||[search,browse].every(value=>value===null||value<=total)&&(search===null||browse===null||search+browse<=total),RESEARCH_INVALID,'Traffic-source counts must fit the total views.');
 const figures={ctrBasisPoints:source.ctrBasisPoints,retentionBasisPoints:source.retentionBasisPoints,searchShareBasisPoints:ratio(search,total),browseShareBasisPoints:ratio(browse,total)};
 let directive:'fix-packaging'|'fix-opening'|'more-intent-clips'|'repeat-packaging'|'collect-evidence'='collect-evidence';
 if(source.ctrBasisPoints!==null&&source.retentionBasisPoints!==null&&source.ctrBasisPoints<thresholds.lowCtrBasisPoints&&source.retentionBasisPoints>=thresholds.highRetentionBasisPoints)directive='fix-packaging';
 else if(source.ctrBasisPoints!==null&&source.retentionBasisPoints!==null&&source.ctrBasisPoints>=thresholds.lowCtrBasisPoints&&source.retentionBasisPoints<thresholds.highRetentionBasisPoints)directive='fix-opening';
 else if(figures.searchShareBasisPoints!==null&&figures.searchShareBasisPoints>=thresholds.trafficShareBasisPoints)directive='more-intent-clips';
 else if(figures.browseShareBasisPoints!==null&&figures.browseShareBasisPoints>=thresholds.trafficShareBasisPoints)directive='repeat-packaging';
 return {directive,figures,thresholds:{...thresholds},source:{...source},caveat:'Observed Studio export only. These house or owner thresholds are a next-step rule, not a prediction.'};
}
