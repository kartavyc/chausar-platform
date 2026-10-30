// Synthetic narration plan scope for isolated provider/media tests. Public onboarding has separate tests.
import {ventureAction,digest} from '../../../runtime/venture/records.ts';
import {owner,type Env} from '../../venture-views-env.ts';
export async function scopeNarration(env:Env,offer='audiobook'){await ventureAction(env.deps,owner,'approve','fixture.narration-scope',tx=>{tx.touch({idea:'An audiobook narration service in Pune'});const plan=tx.list('venture-blueprint').find(p=>p.status==='accepted')!;const updated={...plan,offers:plan.offers.map(o=>o.id==='offer_1'?{...o,playbookOffer:offer}:o)};const {id:_id,at:_at,digest:_digest,status:_status,...body}=updated;tx.replace({...updated,digest:digest(body)});});}
