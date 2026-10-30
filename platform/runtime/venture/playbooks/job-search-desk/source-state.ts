// Original current career ledger identity. Pending facts are never evidence.
import type {State} from '../../../contracts.ts';
import {digest,listRecords} from '../../records.ts';
import {currentCareerFacts} from './state.ts';
export function careerEvidence(state:State,ventureId:string,orderId:string){const order=listRecords(state,'venture-order',ventureId).find(row=>row.id===orderId&&row.status!=='cancelled'),clientId=order?.clientId;const facts=currentCareerFacts(listRecords(state,'venture-career-fact',ventureId).filter(f=>f.orderId===orderId&&f.clientId===clientId).map(f=>f.state)),listings=listRecords(state,'venture-career-listing',ventureId).filter(l=>l.orderId===orderId&&l.clientId===clientId);return {facts,listings,factsDigest:digest(facts),sourcesDigest:digest(listings.map(l=>({id:l.id,url:l.url,text:l.text,revision:l.revision})))};}
