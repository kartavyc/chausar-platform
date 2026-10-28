import type { FakePlaybookDesk } from './fake-playbooks';
import type { W4DeskHost } from './fake-w4';
import { fakeSocialCanvas } from './fake-social-canvas';
import { fakeSocialRevision } from './fake-social-revision';
import { fakeSocialScheduledKind } from './fake-social-scheduled';
export function fakeSocialAgencyDesk(host: W4DeskHost): FakePlaybookDesk { const scheduled=fakeSocialScheduledKind(host),revision=fakeSocialRevision(host);return {receipt:id=>revision.receipt(id),forgetPeople:(people,erase)=>{scheduled.forgetPeople(people,erase);revision.forgetPeople(people,erase);},playbook:'social-agency',kinds:{canvas:fakeSocialCanvas(host),revision,scheduled}}; }
