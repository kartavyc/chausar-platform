// Original source-backed research state, shared with the rehearsal engine. No network or authority is exported.
import {check,digest,type Json} from '../../../portable.ts';
import {searchYoutubeArchive} from './archive.ts';
import {afterPublish,type AfterPublishThresholds} from './after-publish.ts';
import {youtubeOutliers} from './outliers.ts';
import {youtubeNiche} from './niche.ts';
import {triageComments} from './comments.ts';
import {teleprompterPlan} from './teleprompter.ts';
import {researchSource,type ResearchSourceKind} from './research-source.ts';
import {RESEARCH_INVALID} from './b3-core.ts';
export type ResearchMode='after-publish'|'outliers'|'niche'|'comments'|'script'|'archive';
export type YoutubeResearchBody={mode:ResearchMode;source:{id:string;name:string;digest:string};orderDigest:string;mapping:Record<string,string>;options:Record<string,Json>;sourceConsent:true;result:Json;receiptId:string;approval:string|null};
export function researchExact(value:unknown,keys:readonly string[],required:readonly string[]=keys){check(value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)),RESEARCH_INVALID,'Use one named request object.');const result=value as Record<string,unknown>;check(Object.keys(result).every(key=>keys.includes(key))&&required.every(key=>Object.hasOwn(result,key)),RESEARCH_INVALID,'Use exactly the requested fields.');return result;}
const sourceKind:Record<ResearchMode,ResearchSourceKind>={'after-publish':'studio',outliers:'videos',niche:'videos',comments:'comments',script:'script',archive:'archive'};
/** All figures come from the exact uploaded bytes. Replies and options are checked against that source. */
export function computeResearch(mode:ResearchMode,csv:string,mapping:Record<string,string>,raw:unknown):Json {check(Object.hasOwn(sourceKind,mode),RESEARCH_INVALID,'Choose a supported YouTube source analysis.');let result:unknown;
 if(mode==='after-publish'){const options=researchExact(raw,['videoId','thresholds'],['videoId']);const source=researchSource('studio',csv,mapping).find(row=>row.videoId===options.videoId);check(source,RESEARCH_INVALID,'Choose a video in this Studio export.');result=afterPublish(source,options.thresholds as AfterPublishThresholds|undefined);}
 else if(mode==='outliers'){researchExact(raw,[]);result=youtubeOutliers(researchSource('videos',csv,mapping));}
 else if(mode==='niche'){const options=researchExact(raw,['asOf','requested']);result=youtubeNiche(researchSource('videos',csv,mapping),options.asOf as string,options.requested as number);}
 else if(mode==='comments'){const options=researchExact(raw,['replies','pinId'],[]);result=triageComments(researchSource('comments',csv,mapping),options.replies as {id:string;reply:string}[]|undefined,options.pinId as string|null|undefined);}
 else if(mode==='archive'){const options=researchExact(raw,['query']);result=searchYoutubeArchive(researchSource('archive',csv,mapping),options.query as string);}
 else{const options=researchExact(raw,['wordsPerMinute','textSize']);result=teleprompterPlan(researchSource('script',csv,mapping),options.wordsPerMinute as number,options.textSize as number);}
 return result as Json;
}
/** Approval binds the complete result, source identity, mapping and owner choices. */
export function researchApproval(body:YoutubeResearchBody){const {approval:_approval,...covered}=body;return digest(covered);}
export function researchView(id:string,body:YoutubeResearchBody){return {id,...structuredClone(body),digest:digest(body),approved:body.approval===researchApproval(body)};}
/** Only a repeated source question can enter the existing ideas Inbox through this shortcut. */
export function researchIdea(body:YoutubeResearchBody,index:unknown){const result=body.result as {ideas?:{question:string;count:number;commentIds:string[]}[]};check(body.mode==='comments'&&typeof index==='number'&&Number.isSafeInteger(index)&&index>=0,RESEARCH_INVALID,'Choose a repeated source question.');const idea=result.ideas?.[index];check(idea&&idea.count>=3&&idea.commentIds.length>=3&&idea.question.trim().length>=2&&idea.question.trim().length<=300&&!/[\r\n\t]/.test(idea.question),RESEARCH_INVALID,'Choose a repeated question that fits one short idea.');return {text:idea.question.trim(),source:'YouTube source '+body.source.id};}
