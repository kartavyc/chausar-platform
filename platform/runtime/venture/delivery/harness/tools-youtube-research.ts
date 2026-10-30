// Original source-backed YouTube computations. Inputs never accept a statistic, threshold or receipt from the model.
import {check} from '../../../contracts.ts';
import {digest,findRecord} from '../../records.ts';
import {youtubeResearchReceipt} from '../../playbooks/youtube/research-receipt.ts';
import type {ResearchMode} from '../../playbooks/youtube/research-state.ts';
import type {Spec,ToolEnv} from './tools.ts';
type ResearchName='youtube.afterPublish'|'youtube.outliers'|'youtube.niche'|'youtube.comments'|'youtube.archive';
const modes:Record<ResearchName,ResearchMode>={'youtube.afterPublish':'after-publish','youtube.outliers':'outliers','youtube.niche':'niche','youtube.comments':'comments','youtube.archive':'archive'};
async function compute(env:ToolEnv,name:ResearchName){
 check(env.runRef.kind==='delivery','YOUTUBE_SOURCE_REQUIRED','Prepare the client source analysis in this order first.');
 const [{currentYoutubeResearch},{receiptOut}]=await Promise.all([import('../../playbooks/youtube/research-desk.ts'),import('./tools.ts')]);
 const state=env.deps.store.read(),run=findRecord(state,'venture-delivery-run',env.runRef.runId);
 check(run&&run.ventureId===env.ventureId,'YOUTUBE_SOURCE_REQUIRED','Use the current client delivery.');
 const {body}=currentYoutubeResearch(state,env.ventureId,run.orderId,env.now());
 check(body.mode===modes[name],'YOUTUBE_SOURCE_REQUIRED','Prepare the matching source analysis in this order before this calculation.');
 const out=receiptOut(env,youtubeResearchReceipt(env.runRef,body.source,body.result));
 return {result:{analysis:body.result,sourceSeal:digest(body),source:body.source,receipt:out.alias,figures:out.figures,sent:false},receipts:[out.record]};
}
const spec=(name:ResearchName,summary:string):Spec=>({name,effect:'compute',tier:'code',endsTurn:false,summary,input:{},run:env=>compute(env,name)});
export const YOUTUBE_RESEARCH_TOOLS:Readonly<Record<ResearchName,Spec>>=Object.freeze({
 'youtube.afterPublish':spec('youtube.afterPublish','Recheck the owner-prepared Studio source, return its single next directive and exact code receipt. No private Analytics API is claimed.'),
 'youtube.outliers':spec('youtube.outliers','Recheck owner-prepared public video sources and their own-channel medians. Missing or short channels keep named skip reasons.'),
 'youtube.niche':spec('youtube.niche','Recheck the owner-prepared niche source, return code medians, ages and coverage, with a caveat for each figure.'),
 'youtube.archive':spec('youtube.archive','Search the owner-prepared timed transcript source in five-second speech windows. On-screen text and picture search remain planned until owner-installed tools are connected.'),
 'youtube.comments':spec('youtube.comments','Recheck the owner-prepared comments export and return counts first, four piles, held bait and bounded reply drafts. Nothing is posted.'),
});

export const YOUTUBE_PUBLIC_TOOL:Spec={name:'youtube.publicStats',effect:'read',tier:'code',endsTurn:false,input:{},summary:'Read this order completed owner-approved public YouTube result and its code figures. Another API page always requires a separate owner desk approval.',async run(env){check(env.runRef.kind==='delivery','YOUTUBE_SOURCE_REQUIRED','Use the client order public read.');const [{currentYoutubePublic},{receiptOut}]=await Promise.all([import('../../playbooks/youtube/public-desk.ts'),import('./tools.ts')]);const state=env.deps.store.read(),run=findRecord(state,'venture-delivery-run',env.runRef.runId);check(run&&run.ventureId===env.ventureId,'YOUTUBE_SOURCE_REQUIRED','Use the current client delivery.');const {body,source}=currentYoutubePublic(state,env.ventureId,run.orderId,env.now()),out=receiptOut(env,youtubeResearchReceipt(env.runRef,source,body.result!));return {result:{analysis:body.result,sourceSeal:digest(body),source,receipt:out.alias,figures:out.figures,sent:false},receipts:[out.record]};}};
