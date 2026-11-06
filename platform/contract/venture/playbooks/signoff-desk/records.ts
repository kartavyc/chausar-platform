// Canonical browser-safe types, shared by the engine and renderer.
import type { SignoffProfession } from '../../../../shared/venture/playbooks/signoff-desk/professions.ts';

export type SignoffBody=
 | {entry:'professional';profession:SignoffProfession;name:string;registrationNumber:string}
 | {entry:'request';profession:SignoffProfession;deliveryId:string;orderId:string;clientId:string;workingDigest:string;title:string}
 | {entry:'sent';requestId:string;name:string;registrationNumber:string}
 | {entry:'decision';requestId:string;decision:'signed'|'returned';name:string;registrationNumber:string;workingDigest:string;note:string|null};
