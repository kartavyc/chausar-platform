// Original Chausar social work desk. Load stateful handlers only when called, avoiding flagship import cycles.
import type { DeskHandlers } from '../desk-types.ts';
import type { SocialCanvasDeskTypes } from './canvas-desk.ts';
import type { SocialRevisionDeskTypes } from './revision-desk.ts';
import type { ScheduledDeskTypes } from './scheduled-desk.ts';
export type SocialAgencyDeskTypes = SocialCanvasDeskTypes & SocialRevisionDeskTypes & ScheduledDeskTypes;
export const SOCIAL_AGENCY_DESK: DeskHandlers = Object.freeze({
 canvas:{async list(...args){return (await import('./canvas-desk.ts')).SOCIAL_CANVAS_DESK.canvas.list!(...args);},async get(...args){return (await import('./canvas-desk.ts')).SOCIAL_CANVAS_DESK.canvas.get!(...args);}},
 revision:{async list(...args){return (await import('./revision-desk.ts')).SOCIAL_REVISION_DESK.revision.list!(...args);},async get(...args){return (await import('./revision-desk.ts')).SOCIAL_REVISION_DESK.revision.get!(...args);},async act(...args){return (await import('./revision-desk.ts')).SOCIAL_REVISION_DESK.revision.act!(...args);}},
 scheduled:{async list(...args){return (await import('./scheduled-desk.ts')).SCHEDULED_DESK.scheduled.list!(...args);},async get(...args){return (await import('./scheduled-desk.ts')).SCHEDULED_DESK.scheduled.get!(...args);},async act(...args){return (await import('./scheduled-desk.ts')).SCHEDULED_DESK.scheduled.act!(...args);}},
});
