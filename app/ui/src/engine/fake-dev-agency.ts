/**
 * The fake engine's desk for Dev agency: maintenance, QA and security reviews (Ink v2 wave 5, packages 5R4), in the
 * engine's shapes, codes and words (platform/runtime/venture/playbooks/dev-agency/desk.ts). Package 5-0 left it empty,
 * so venture.desk.* for this playbook answers NOT_BUILT_YET, as the engine does; the package fills its record kinds
 * here.
 */

import type { FakePlaybookDesk } from './fake-playbooks';
import type { W4DeskHost } from './fake-w4';

/** The desk, empty until its package lands: it answers no record kind. */
export function fakeDevAgencyDesk(_host: W4DeskHost): FakePlaybookDesk {
  return { playbook: 'dev-agency', kinds: {} };
}
