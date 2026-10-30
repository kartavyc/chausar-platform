// Original vault binding for an explicitly added YouTube service; never infer it from owner prose.
import {check,type State} from '../../../contracts.ts';
import {listRecords} from '../../records.ts';
import type {Offer,VentureRecord} from '../../contracts.ts';
import {pickPlaybook} from '../registry.ts';
import {isYoutubeService} from './service-offer.ts';
export function requireYoutubeServiceBinding(state:State,venture:VentureRecord,offer:Offer){
 const record=listRecords(state,'venture-owner-offer',venture.id).find(row=>row.offerId===offer.id&&row.removedAt===null);
 if(!isYoutubeService(offer.playbookOffer)&&!record?.youtubeService)return;
 check(pickPlaybook(venture.idea)?.id==='youtube'&&offer.addedByOwner===true&&record&&record.youtubeService===offer.playbookOffer&&isYoutubeService(record.youtubeService),'YOUTUBE_SERVICE_INVALID','The service identity changed. Review the owner-added service again.');
}
