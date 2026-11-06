import type { CallLogBody, ReceptionistLog } from '../../../../contract/venture/playbooks/phone-receptionist/records.ts';
export type { CallLogBody, ReceptionistLog } from '../../../../contract/venture/playbooks/phone-receptionist/records.ts';
// Chausar playbook: AI phone receptionist (Ink v2 wave 5, packages 5R6). The bodies of its own records, as contracts.ts
// types each one (RecordBase<kind> & Body). Package 5-0 named each as a placeholder; the package replaces it with the
// record's fields here, never in contracts.ts. Types only. Written for Chausar; nothing here is learned from an outside
// source.

/** venture-call-log: a placeholder until package 5R6 lands. */
import type {ReceptionistFacts,receptionistScript} from './script.ts';import type {CallRates,priceCall} from './call-cost.ts';import type {CallBudget} from './budget.ts';import type {CallLog} from './logs.ts';


