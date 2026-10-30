import type {OpenPostingDeskTypes} from '../../build/open-posting-accounts.ts';
// Original Chausar social work desk. Load stateful handlers only when called, avoiding flagship import cycles.
import type { DeskHandlers } from '../desk-types.ts';
import type { SocialCanvasDeskTypes } from './canvas-desk.ts';
import type { SocialRevisionDeskTypes } from './revision-desk.ts';
import type { ScheduledDeskTypes } from './scheduled-desk.ts';
import type { SocialInboxDeskTypes } from './inbox-desk.ts';
import type { SocialProductionDeskTypes } from './production-desk.ts';
import type { SocialInfluencerDeskTypes } from './influencer-desk.ts';
export type SocialAgencyDeskTypes = OpenPostingDeskTypes & SocialCanvasDeskTypes & SocialRevisionDeskTypes & ScheduledDeskTypes & SocialInboxDeskTypes & SocialProductionDeskTypes & SocialInfluencerDeskTypes;
export const SOCIAL_AGENCY_DESK: DeskHandlers = Object.freeze({
 'open-posting':{async list(...args){return (await import('../../build/open-posting-accounts.ts')).OPEN_POSTING_DESK['open-posting'].list!(...args);},async get(...args){return (await import('../../build/open-posting-accounts.ts')).OPEN_POSTING_DESK['open-posting'].get!(...args);},async act(...args){return (await import('../../build/open-posting-accounts.ts')).OPEN_POSTING_DESK['open-posting'].act!(...args);}},
 influencer:{async list(...args){return (await import('./influencer-desk.ts')).SOCIAL_INFLUENCER_DESK.influencer.list!(...args);},async get(...args){return (await import('./influencer-desk.ts')).SOCIAL_INFLUENCER_DESK.influencer.get!(...args);},async act(...args){return (await import('./influencer-desk.ts')).SOCIAL_INFLUENCER_DESK.influencer.act!(...args);}},
 production:{async list(...args){return (await import('./production-desk.ts')).SOCIAL_PRODUCTION_DESK.production.list!(...args);},async get(...args){return (await import('./production-desk.ts')).SOCIAL_PRODUCTION_DESK.production.get!(...args);},async act(...args){return (await import('./production-desk.ts')).SOCIAL_PRODUCTION_DESK.production.act!(...args);}},
 inbox:{async list(...args){return (await import('./inbox-desk.ts')).SOCIAL_INBOX_DESK.inbox.list!(...args);},async get(...args){return (await import('./inbox-desk.ts')).SOCIAL_INBOX_DESK.inbox.get!(...args);},async act(...args){return (await import('./inbox-desk.ts')).SOCIAL_INBOX_DESK.inbox.act!(...args);}},
 canvas:{async list(...args){return (await import('./canvas-desk.ts')).SOCIAL_CANVAS_DESK.canvas.list!(...args);},async get(...args){return (await import('./canvas-desk.ts')).SOCIAL_CANVAS_DESK.canvas.get!(...args);}},
 revision:{async list(...args){return (await import('./revision-desk.ts')).SOCIAL_REVISION_DESK.revision.list!(...args);},async get(...args){return (await import('./revision-desk.ts')).SOCIAL_REVISION_DESK.revision.get!(...args);},async act(...args){return (await import('./revision-desk.ts')).SOCIAL_REVISION_DESK.revision.act!(...args);}},
 scheduled:{async list(...args){return (await import('./scheduled-desk.ts')).SCHEDULED_DESK.scheduled.list!(...args);},async get(...args){return (await import('./scheduled-desk.ts')).SCHEDULED_DESK.scheduled.get!(...args);},async act(...args){return (await import('./scheduled-desk.ts')).SCHEDULED_DESK.scheduled.act!(...args);}},
});
