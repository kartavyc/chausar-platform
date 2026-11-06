// Chausar playbook: the sign-off desk (wave 6, 6E5). Browser-safe registration only.
import type {PlaybookRegistration} from '../registry.ts';

export const SIGNOFF_DESK_ID='signoff-desk';
// serviceType: the 'licensed' family type 6E1 added to core/service-types.ts.
export const SIGNOFF_DESK_REGISTRATION:PlaybookRegistration=Object.freeze({id:SIGNOFF_DESK_ID,label:'Sign-off desk',serviceType:'licensed',
 picks:Object.freeze(['sign-off desk','signoff desk','advocate','law practice','legal drafting','doctor practice','doctor follow-up','patient follow-up','clinic follow-up','financial planner','mutual fund distributor','company secretary','secretarial work']),
 summary:'Agents prepare regulated papers; a named licensed professional signs each one before it reaches a client, and tools the regulator forbids stay off.',
 riskLevel:'high',lastReviewed:'2026-11-01'});
