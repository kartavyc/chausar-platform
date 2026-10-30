/** Original Chausar social fake desk. Shared pure views preserve the engine's shapes. */
import type { FakePlaybookDesk } from './fake-playbooks';
import type { W4DeskHost } from './fake-w4';
import { fakeSocialCanvas } from './fake-social-canvas';
import { fakeSocialRevision } from './fake-social-revision';
import { fakeSocialScheduledKind } from './fake-social-scheduled';
import { fakeSocialProduction } from './fake-social-production';
import { fakeSocialInbox } from './fake-social-inbox';
import { fakeSocialInfluencer } from './fake-social-influencer';
import {fakeOpenPosting} from './fake-open-posting';
export function fakeSocialAgencyDesk(host: W4DeskHost): FakePlaybookDesk { const openPosting=fakeOpenPosting(host), influencer=fakeSocialInfluencer(host), production=fakeSocialProduction(host), inbox=fakeSocialInbox(host), scheduled = fakeSocialScheduledKind(host); const revision=fakeSocialRevision(host); return { endSession:()=>openPosting.endSession(), receipt: id=>production.receipt(id)??revision.receipt(id), forgetPeople: (people, erase) => {openPosting.forgetPeople(people,erase);influencer.forgetPeople(people,erase);scheduled.forgetPeople(people, erase);revision.forgetPeople(people,erase);inbox.forgetPeople(people,erase);production.forgetPeople(people,erase);}, playbook: 'social-agency', kinds: { canvas: fakeSocialCanvas(host), revision, scheduled, inbox, production, influencer, 'open-posting':openPosting } }; }
