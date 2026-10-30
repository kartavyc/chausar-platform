// Chausar playbook: Data entry desk (Ink v2 wave 5, packages 5R2). The bodies of its own records, as contracts.ts types
// each one (RecordBase<kind> & Body). Package 5-0 named each as a placeholder; the package replaces it with the
// record's fields here, never in contracts.ts. Types only. Written for Chausar; nothing here is learned from an outside
// source.

import type {FormReadback} from './types.ts';
export type FormSiteApproval={url:string;origin:string;permissionFileId:string;permissionDigest:string;savedSignInId:string|null};
export type FormSubmitReview={handle:string;digest:string;url:string;method:'POST';review:{name:string;value:string|null}[];sensitive:boolean;credential:boolean;expiresAt:string};
/** Private browser bodies and login secrets are never persisted here. Only an opaque cleaned screenshot file link is kept. */
export type EntryRecordBody={
 orderId:string;clientId:string;fileId:string;identityColumn:string;rowIndex:number;
 sourceRecordId:string;sourceDigest:string;rowDigest:string;state:'source'|'open'|'captured'|'filled'|'review'|'submitting'|'response'|'sign-in-response'|'outcome-unknown'|'not-sent'|'checked';
 screenshot?:{fileId:string;digest:string;pageHash:string;origin:string;requestDigest:string}|null;
 signIns?:{id:string;origin:string}[];site?:FormSiteApproval;browserRunId?:string;pageHash?:string;
 mappingProposal?:{pageHash:string;sourceDigest:string;mapping:{column:string;targetId:string}[]};
 mapping?:{column:string;name:string;value:string}[];submitReview?:FormSubmitReview|null;
 submitIntent?:'record'|'sign-in';journalSubject?:string;
 responseEvidence?:{requestId:number|string;url:string;statusCode:number}|null;
 comparison?:FormReadback|null;
};
