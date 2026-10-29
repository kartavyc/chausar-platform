// Native source authority for read-only monitor tools and delivery checks. No fetch is hidden inside a tool.
import {check,type State} from '../../../contracts.ts';import type {VentureDeps} from '../../contracts.ts';import {findRecord,listRecords} from '../../records.ts';import {watchOrder,currentWatch,type WatchStore} from './sources.ts';
export function r5StateStore(state:State,ventureId:string,now:string):WatchStore{const venture=findRecord(state,'venture-record',ventureId);check(venture,'VENTURE_NOT_FOUND','Choose a current business.');return {venture,now,find:(kind,id)=>listRecords(state,kind,ventureId).find(r=>r.id===id),list:kind=>listRecords(state,kind,ventureId)};}
export function r5RunStore(deps:VentureDeps,ventureId:string){return r5StateStore(deps.store.read(),ventureId,deps.clock().toISOString());}
export function watchStateRows(state:State,ventureId:string,orderId:string,now:string){const tx=r5StateStore(state,ventureId,now);watchOrder(tx,orderId);const rows=tx.list('venture-watch-source').filter(r=>r.orderId===orderId).map(r=>currentWatch(tx,r.id));check(rows.length>0&&rows.every(r=>r.observation),'WATCH_SELECTOR_UNCHECKED','Check every selected source before preparing this report.');return rows;}

import {watchReport} from './report.ts';
export function watchStateSource(state:State,ventureId:string,orderId:string,now:string){return watchReport(watchStateRows(state,ventureId,orderId,now));}
export function watchRunSource(deps:VentureDeps,ventureId:string,orderId:string){return watchStateRows(deps.store.read(),ventureId,orderId,deps.clock().toISOString());}
