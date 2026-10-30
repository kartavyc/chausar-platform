// Rating count honesty, ResolveHQ (source-available) ideas only, independently implemented.
import { check } from '../../../contracts.ts';
import type { SupportRatingBody } from './records.ts';
/** A plain-link response can add one rating per ticket. No pixel is created. */
export function addRating(existing:readonly SupportRatingBody[],ticketId:string,score:number,at:string):SupportRatingBody[] {
  check(Number.isInteger(score)&&score>=1&&score<=5,'SUPPORT_RATING_INVALID','Choose a rating from one to five.');
  check(!existing.some(r=>r.ticketId===ticketId),'SUPPORT_RATING_EXISTS','This ticket already has its rating.');
  return [...existing,{ticketId,score,at}];
}
/** Small samples show count only; every average carries its denominator. */
export function ratingSummary(ratings:readonly SupportRatingBody[]):{count:number;average:string|null;line:string} {
  const count=ratings.length;const average=count<5?null:(ratings.reduce((sum,r)=>sum+r.score,0)/count).toFixed(1);
  return {count,average,line:average?`${average} from ${count} ratings`:`${count} ${count===1?'rating':'ratings'}`};
}
