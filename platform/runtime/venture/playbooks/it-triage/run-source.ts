// Native triage evidence remains tied to the current accepted client order and exact owner approval.
import {check,digest} from '../../../portable.ts';import type {VentureDeps} from '../../contracts.ts';import {r5RunStore} from '../monitored-data/run-source.ts';import {currentTriage} from './desk.ts';
export function triageRunSource(deps:VentureDeps,ventureId:string,orderId:string){const row=currentTriage(r5RunStore(deps,ventureId),orderId);check(row.summary&&row.approved===row.summary.digest&&row.summary.sourceDigest===digest(row.messages),'APPROVAL_REQUIRED','Approve the exact current channel summary before preparing delivery.');return {row,summary:row.summary};}

import type {State} from '../../../contracts.ts';
import {r5StateStore} from '../monitored-data/run-source.ts';
import {triageReport} from './report.ts';
export function triageStateSource(state:State,ventureId:string,orderId:string,now:string){return triageReport(currentTriage(r5StateStore(state,ventureId,now),orderId));}
