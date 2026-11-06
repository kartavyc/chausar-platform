// Canonical browser-safe types, shared by the engine and renderer.
import type { ReceptionistFacts } from '../../../../shared/venture/playbooks/phone-receptionist/script.ts';
import type { receptionistScript } from '../../../../shared/venture/playbooks/phone-receptionist/script.ts';
import type { CallRates } from '../../../../shared/venture/playbooks/phone-receptionist/call-cost.ts';
import type { CallBudget } from '../../../../shared/venture/playbooks/phone-receptionist/budget.ts';
import type { CallLog } from '../../../../shared/venture/playbooks/phone-receptionist/logs.ts';
import type { priceCall } from '../../../../shared/venture/playbooks/phone-receptionist/call-cost.ts';

export type CallLogBody={orderId:string;clientId:string;orderDigest:string;facts:ReceptionistFacts;language:'en'|'hi';script:ReturnType<typeof receptionistScript>|null;rates:CallRates|null;budget:CallBudget|null;logs:ReceptionistLog[]};

export type ReceptionistLog={month:string;log:CallLog;cost:ReturnType<typeof priceCall>;receiptId:string;importDigest:string;bookedByAgent:false;reviews:{requestId:string;outcome:'handled-manually'|'no-action';at:string}[]};
