// Chausar playbook: AI phone receptionist (Ink v2 wave 5, packages 5R6). The bodies of its own records, as contracts.ts
// types each one (RecordBase<kind> & Body). Package 5-0 named each as a placeholder; the package replaces it with the
// record's fields here, never in contracts.ts. Types only. Written for Chausar; nothing here is learned from an outside
// source.

/** venture-call-log: a placeholder until package 5R6 lands. */
import type {ReceptionistFacts,receptionistScript} from './script.ts';import type {CallRates,priceCall} from './call-cost.ts';import type {CallBudget} from './budget.ts';import type {CallLog} from './logs.ts';
export type ReceptionistLog={month:string;log:CallLog;cost:ReturnType<typeof priceCall>;receiptId:string;importDigest:string;bookedByAgent:false;reviews:{requestId:string;outcome:'handled-manually'|'no-action';at:string}[]};
export type CallLogBody={orderId:string;clientId:string;orderDigest:string;facts:ReceptionistFacts;language:'en'|'hi';script:ReturnType<typeof receptionistScript>|null;rates:CallRates|null;budget:CallBudget|null;logs:ReceptionistLog[]};
