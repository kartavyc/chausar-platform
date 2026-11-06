// Original measured-audio checks against official ACX and Spotify specifications read 2026-10-29.
import {check} from '../../../portable.ts';
export type NarrationDestination='client'|'spotify'|'acx'|'google-play';
export type NarrationMeasurements={durationMs:number;format:string;sampleRate:number;bitrateKbps:number|null;constantBitrate:boolean|null;bitDepth:number|null;channels:number;rmsTenths:number|null;peakTenths:number|null;noiseTenths:number|null;headMs:number|null;tailMs:number|null};
export const NARRATION_SPECS={checkedOn:'2026-10-29',acx:'https://help.acx.com/s/article/what-are-the-acx-audio-submission-requirements',spotify:'https://support.spotifycdn.com/pdf/SFA%20Metadata_Asset%20Guide_2024.pdf',spotifyPolicy:'https://support.spotify.com/us/authors/article/digital-voice-narration/',google:'https://support.google.com/books/partner/answer/10013009?hl=en'} as const;
/** Export qualification covers measured technical checks only; distributors still make their own decision. */
export function narrationMasterCheck(destination:NarrationDestination,measurements:NarrationMeasurements|null){
 check(['client','spotify','acx','google-play'].includes(destination),'NARRATION_DESTINATION_INVALID','Choose the client or a listed distributor.');
 const findings:{id:string;outcome:'pass'|'fail'|'not-run'}[]=[];const add=(id:string,value:boolean|null)=>findings.push({id,outcome:value===null?'not-run':value?'pass':'fail'});
 add('synthetic-permission',destination==='acx'||destination==='google-play'?false:true);
 const m=measurements;add('measured-duration',m?Number.isSafeInteger(m.durationMs)&&m.durationMs>0&&m.durationMs<=7200000:null);
 add('finite-measurements',m?[m.durationMs,m.sampleRate,m.channels,m.bitrateKbps,m.bitDepth,m.rmsTenths,m.peakTenths,m.noiseTenths,m.headMs,m.tailMs].every(value=>value===null||Number.isFinite(value)&&Number.isSafeInteger(value)):null);
 add('channels',m?m.channels===1||m.channels===2:null);add('sample-rate',m?m.sampleRate===44100:null);
 add('format',m?destination==='acx'?m.format==='mp3':['mp3','wav','flac'].includes(m.format):null);
 add('bit-depth',m?(m.format==='wav'||m.format==='mp3')?m.bitDepth===null?null:m.bitDepth===16:true:null);
 add('bitrate',m?m.format==='mp3'?m.bitrateKbps===null?null:m.bitrateKbps>=192:true:null);
 add('constant-bitrate',m?m.format==='mp3'&&destination==='acx'?m.constantBitrate:true:null);
 add('rms',m?.rmsTenths===null||m?.rmsTenths===undefined?null:m.rmsTenths>=(destination==='acx'?-230:-240)&&m.rmsTenths<=(destination==='acx'?-180:-140));
 add('peak',m?.peakTenths===null||m?.peakTenths===undefined?null:m.peakTenths<=-30);
 add('noise-floor',m?.noiseTenths===null||m?.noiseTenths===undefined?null:m.noiseTenths<=-600);
 add('head',m?.headMs===null||m?.headMs===undefined?null:m.headMs>=(destination==='acx'?1000:500)&&m.headMs<=(destination==='acx'?5000:1000));
 add('tail',m?.tailMs===null||m?.tailMs===undefined?null:m.tailMs>=1000&&m.tailMs<=5000);
 add('room-tone-duration',m?.headMs===null||m?.headMs===undefined||m?.tailMs===null||m?.tailMs===undefined?null:m.headMs+m.tailMs<m.durationMs);
 return {pass:findings.every(f=>f.outcome==='pass'),findings,checkedOn:NARRATION_SPECS.checkedOn,disclosure:'AI narration'};
}
