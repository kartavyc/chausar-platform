// Original career adapter reuses the reviewed recruiting public-board reader and normalization.
import {robotsSafe,type PoliteNet} from '../../build/fetch-policy.ts';
import {pinnedSend} from '../../core/net-guard.ts';
import {boardJobs,boardUrl,type BoardGates} from '../recruiting-desk/boards.ts';
import {readBoard} from '../recruiting-desk/boards-read.ts';
/** An index match is explicitly not a captured complete job page. Read or paste that page separately. */
export async function readCareerBoard(provider:string,slug:string,gates:BoardGates,net:PoliteNet={}){
 const url=boardUrl(provider,slug);boardJobs(provider,provider==='lever'?[]:{jobs:[]},gates);
 const data=await readBoard(provider,slug,{...net,send:robotsSafe(net.send??pinnedSend,net.resolve)});
 return {url,rows:boardJobs(provider,data,gates),evidence:'public-board-index' as const,fullJobTextRead:false as const,submitted:false as const};
}
