// Exact opaque emulator screen-file cleanup survives failure, Forget and a new desktop process.
import {check,type Context} from '../../../contracts.ts';import type {VentureDeps} from '../../contracts.ts';
import {ventureAction,digest} from '../../records.ts';import {readAs} from '../../delivery/shared.ts';
import type {AndroidScreenCleanup,AndroidScreenFile} from '../../build/android.ts';
export function appScreenCleanup(deps:VentureDeps,ctx:Context):AndroidScreenCleanup{
 const ventureId=readAs(deps,ctx,'approve').venture.id;
 const live=()=>{const result=readAs(deps,ctx,'approve');check(ctx.role==='owner'&&result.venture.id===ventureId,'OWNER_REQUIRED','Only the current owner can clear this emulator screen.');return result;};
 return{
  pending:()=>structuredClone(live().venture.appTestScreenErasure??[]),
  async remember(file){live();check(!deps.closing?.signal.aborted,'APPROVAL_STALE','This workspace is closing.');await ventureAction(deps,ctx,'approve','apptest.screen-prepare',tx=>{check(tx.venture?.id===ventureId,'APPROVAL_STALE','The workspace changed.');check(!tx.venture.appTestScreenErasure?.length,'APP_TEST_CLEANUP_PENDING','Finish clearing the earlier emulator screen before another read.');tx.touch({appTestScreenErasure:[{...file}]});});},
  async forget(file){live();await ventureAction(deps,ctx,'approve','apptest.screen-cleared',tx=>{check(tx.venture?.id===ventureId,'APPROVAL_STALE','The workspace changed.');tx.touch({appTestScreenErasure:(tx.venture.appTestScreenErasure??[]).filter(saved=>digest(saved)!==digest(file))});});},
  guard(file){check(live().venture.appTestScreenErasure?.some(saved=>digest(saved)===digest(file)),'APPROVAL_STALE','This exact emulator screen cleanup is no longer current.');},
  hold:()=>deps.closing?.hold()??(()=>{}),
 };
}
