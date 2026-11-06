// Original explicit service identity. The three starter offers remain in plan.ts unchanged.
import {check} from '../../../portable.ts';
import type {FlagshipOffer,FlagshipPlan} from '../plan.ts';
import {youtubeService} from './offers2.ts';
import {isYoutubeService,youtubeServiceIntake} from './service-fields.ts';
export {isYoutubeService,youtubeServiceIntake,validateYoutubeServiceIntake} from './service-fields.ts';
export function youtubeServiceOffer(plan:FlagshipPlan|null,offer:{playbookOffer?:string;addedByOwner?:true;name?:{value:string}}|null|undefined):FlagshipOffer|null{
 if(!isYoutubeService(offer?.playbookOffer))return null;
 check(plan?.id==='youtube'&&offer?.addedByOwner===true,'YOUTUBE_SERVICE_INVALID','This exact YouTube service must be added by the owner to a YouTube business.');
 const service=youtubeService(offer.playbookOffer);return {key:service.id,name:offer.name?.value??service.name,description:service.description,model:service.pricing,block:service.pricing==='monthly'?'retainer':'one-off-project',rights:service.rightsBases,intake:youtubeServiceIntake(service.id)};
}
