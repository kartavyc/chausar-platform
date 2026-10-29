// Original deterministic YouTube figure projection. Source and formula evidence stay on the established work receipt.
import {digest,type Json} from '../../../portable.ts';
type WorkFigure={key:string;label:string;minor:string;display:string;currency:string;unit:'count'|'percent'};
import type {YoutubeResearchBody} from './research-state.ts';
/** Traverse only explicit numeric values from our deterministic calculators, never figures in prose or IDs. */
export function youtubeResearchReceipt(runRef:{kind:'delivery';runId:string},source:YoutubeResearchBody['source'],result:Json) {
 const figures:WorkFigure[]=[];
 function visit(value:Json,path:string){if(value===null)return;if(Array.isArray(value)){value.forEach((row,i)=>visit(row,path?path+'.'+i:String(i)));return;}if(typeof value==='object'){for(const [key,item]of Object.entries(value))if(!['id','videoId','channelId','sourceId','commentIds','source','thresholds','lines','piles','replies','ideas','direction','words','shown','text','title','asOf','publishedOn','dropFirst'].includes(key))visit(item,path?path+'.'+key:key);return;}
  if(typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&/^(0|[1-9]\d*)(?:\.5)?$/.test(value)){const numeric=String(value),percent=/BasisPoints$/.test(path),minor=numeric,display=percent?String(BigInt(numeric)/100n)+'.'+String(BigInt(numeric)%100n).padStart(2,'0')+'%':numeric;figures.push({key:path,label:path,minor,display,currency:'INR',unit:percent?'percent':'count'});}}
 visit(result,'');const body={operation:'youtube.compute' as const,runRef,currency:'INR',inputs:{tables:[source],columns:{source:source.name},rowIds:[]},steps:figures.map(figure=>({op:'compare' as const,inputs:[source.id],result:figure.minor,rule:'Deterministic YouTube source calculation. Missing values remain unavailable; ratios truncate to whole hundredths.'})),figures,reconciliation:null,allowedNumbers:figures.flatMap(figure=>[figure.minor,figure.display]),explanation:'Computed from the named source bytes and exact owner choices. Coverage and caveats remain beside each result.'};return {...body,digest:digest(body)};
}
