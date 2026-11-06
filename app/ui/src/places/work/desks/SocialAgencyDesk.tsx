import { SocialCanvas } from './SocialCanvas';
import { SocialSchedule } from './SocialSchedule';
import { SocialProduction } from './SocialProduction';
import { SocialInbox } from './SocialInbox';
import { SocialInfluencer } from './SocialInfluencer';
export function SocialAgencyDesk() { return <><SocialCanvas /><SocialSchedule /><SocialInbox /><SocialProduction /><SocialInfluencer /></>; }
SocialAgencyDesk.ready = true;
