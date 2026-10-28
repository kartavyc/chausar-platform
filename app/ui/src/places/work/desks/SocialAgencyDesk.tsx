import { SocialCanvas } from './SocialCanvas';
import { SocialSchedule } from './SocialSchedule';
import { SocialProduction } from './SocialProduction';
import { SocialInbox } from './SocialInbox';
export function SocialAgencyDesk() { return <><SocialCanvas /><SocialSchedule /><SocialInbox /><SocialProduction /></>; }
SocialAgencyDesk.ready = true;
