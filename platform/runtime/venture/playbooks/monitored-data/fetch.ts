// Exact approved static-page read. Existing 5A6 policy and robots guards protect every physical request.
import {check} from '../../../portable.ts';
import {politeFetch,robotsSafe,type PoliteNet} from '../../build/fetch-policy.ts';
import {pinnedSend,type PinnedSender} from '../../core/net-guard.ts';
import {monitoredTerms} from './extract.ts';
export async function readWatchedPage(raw:{url:unknown;terms:unknown;at:string},net:PoliteNet,beforeDispatch:()=>void){
 const input=structuredClone(raw),approved=monitoredTerms(input.url,input.terms,input.at);beforeDispatch();
 const checkedSend:PinnedSender=target=>{beforeDispatch();return (net.send??pinnedSend)(target);};
 const response=await politeFetch({url:approved.url,maxBytes:1_048_576,maxRedirects:0,timeoutMs:15000,headers:{accept:'text/html, text/plain'}},{resolve:net.resolve,send:robotsSafe(checkedSend,net.resolve)});
 beforeDispatch();check(response.status>=200&&response.status<300,'WATCH_FETCH_FAILED','The approved source did not return a readable page.');check(response.url===approved.url,'APPROVAL_STALE','The source moved. Approve the new exact address before reading it.');
 return {...approved,html:response.body.toString('utf8'),observedAt:input.at};
}
