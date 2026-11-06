// Canonical browser-safe types, shared by the engine and renderer.
import type { DevOffer } from '../../../../shared/venture/playbooks/dev-agency/permission.ts';
import type { DevPermission } from '../../../../shared/venture/playbooks/dev-agency/permission.ts';
import type { DevRead } from '../../../../shared/venture/playbooks/dev-agency/source-core.ts';
import type { DevFinding } from '../../../../shared/venture/playbooks/dev-agency/verdict.ts';
import type { AuditFinding } from './scanners.ts';
import type { DevPush } from '../../../../shared/venture/playbooks/dev-agency/handoff.ts';
import type { DevPushResult } from '../../../../shared/venture/playbooks/dev-agency/handoff.ts';

export type DevPermissionBody={orderId:string;clientId:string;offer:DevOffer;orderDigest:string;fileId:string;sourceDigest:string;repository:string;revision:string;startedAt:string;permission:DevPermission|null;reads:DevRead[];findings:DevFinding[];reviewConfirmed:boolean;audit:{sourceDigest:string;findings:AuditFinding[];at:string}|null;patch:{text:string;digest:string;approved:string|null}|null;push:DevPush|DevPushResult|null;pushJournalId?:string|null;cli?:{generation:number;state:'running'|'finished'|'unknown';approval:string;delegateId:string|null;untrusted:true}};
