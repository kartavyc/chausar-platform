// Read-only Today rows retain the current accepted client/source authority.
import type {Context,State} from '../../../contracts.ts';
import type {VentureDeps,VentureRecord} from '../../contracts.ts';
import type {W4RowItem} from '../../views/queue-w4.ts';
import {r5StateStore} from './run-source.ts';import {currentWatch} from './sources.ts';import {watchNotice} from './notice-core.ts';
export function watchSourceRows(deps:VentureDeps,_ctx:Context,state:State,venture:VentureRecord):W4RowItem[]{
 const tx=r5StateStore(state,venture.id,deps.clock().toISOString());return tx.list('venture-watch-source').flatMap(row=>{try{currentWatch(tx,row.id);const notice=watchNotice(row);if(!notice)return[];const {link,...body}=notice;return[{...body,kind:'notice' as const,actions:[{id:'open' as const,label:'Open monitored sources',primary:true},{id:'later' as const,label:'Later',primary:false}],navigate:'Open Work to review this source.',notice:{probe:'drafts' as const,severity:'medium' as const,link}}];}catch{return[];}});
}
