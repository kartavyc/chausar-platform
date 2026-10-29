// Readable source findings. Numeric figures are rendered separately from the engine work receipt.
import {ExternalLink} from '../../connections/external';
import {YoutubeCommentIdeas} from './YoutubeCommentIdeas';
import {YoutubePrompter} from './YoutubePrompter';
import {useT} from '../../../text';import type {YoutubeResearchView} from './YoutubeResearch';import s from './YoutubeResearch.module.css';
export function YoutubeResearchResult({view,canAct=false}:{view:YoutubeResearchView;canAct?:boolean}){const t=useT(),w=(key:string)=>t('pb-youtube-research.'+key),result=view.result as Record<string,unknown>;
 if(view.mode==='after-publish')return <p>{w('directive.'+result.directive)}</p>;
 if(view.mode==='outliers')return <><p>{w('outlierBoundary')}</p>{(result.skipped as {channelId:string;reason:string}[]??[]).map(row=><p key={row.channelId}><span data-content="">{row.channelId}</span>{': '+w('reason.'+row.reason)}</p>)}{(result.videos as {id:string;channelId:string;reason:string|null}[]??[]).map(row=><p key={row.id}><span data-content="">{row.channelId+' / '+row.id}</span>{row.reason&&': '+w('reason.'+row.reason)}</p>)}</>;
 if(view.mode==='niche')return <p>{w('nicheBoundary')}</p>;
 if(view.mode==='comments'){const piles=result.piles as Record<string,{id:string;text:string}[]>;return <><p>{w('commentsBoundary')}</p><ExternalLink href="https://studio.youtube.com/">{w('openStudio')}</ExternalLink>{Object.entries(piles??{}).map(([pile,rows])=><section key={pile}><h4>{w('pile.'+pile)}</h4>{rows.map(row=><blockquote key={row.id} data-content=""><p>{row.id}</p>{row.text}</blockquote>)}</section>)}{(result.replies as {id:string;reply:string}[]??[]).map(row=><blockquote key={row.id} data-content=""><p>{row.id}</p>{row.reply}</blockquote>)}{typeof result.pinId==='string'&&<p data-content="">{w('pinId')+': '+result.pinId}</p>}<YoutubeCommentIdeas key={view.digest} view={view} canAct={canAct}/></>;}
 if(view.mode==='archive')return <><p>{w('archiveBoundary')}</p>{(result.hits as {sourceId:string;text:string}[]??[]).map((hit,index)=><blockquote key={index} data-content=""><p>{hit.sourceId}</p>{hit.text}</blockquote>)}</>;
 if(view.approved)return <YoutubePrompter key={view.digest} lines={result.lines as {kind:'speech'|'cue';text:string;durationMs:number}[]} textSize={result.textSize as number}/>;
 return <><p>{w('scriptBoundary')}</p>{(result.lines as {kind:string;text:string}[]??[]).map((line,index)=><p key={index} className={s.source} data-content="">{line.text}</p>)}</>;
}
