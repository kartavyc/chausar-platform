// Public board reads use the shared network policy. No credentials, profile reads, or application writes.
import {check} from '../../../contracts.ts';
import {politeFetch,type PoliteNet} from '../../build/fetch-policy.ts';
import {boardUrl} from './boards.ts';
export async function readBoard(provider:string,slug:string,net:PoliteNet={}){const response=await politeFetch({url:boardUrl(provider,slug),maxBytes:2000000,timeoutMs:15000,maxRedirects:0},net);check(response.status===200,'RECRUIT_BOARD_UNAVAILABLE','The public board did not answer. The saved seen set is unchanged.');try{return JSON.parse(response.body.toString('utf8')) as unknown;}catch{check(false,'RECRUIT_BOARD_UNAVAILABLE','The public board returned unreadable data.');}}
