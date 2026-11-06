// Chausar playbook: the document desk (wave 6, 6E4). The body of its one record kind, 'venture-document', as
// contracts.ts types it (RecordBase<'venture-document'> & DocumentBody): one document per client order, with its type,
// outline, the client files it rests on (bound by digest), the figures table code computed (with its receipt), the
// owner's two approvals (the brief before AI work, the finished document before export). Types only. Written for Chausar.

export const DOCUMENT_TYPES=['handbook','sop','project-report','estimate','thesis-edit','technical'] as const;
export type DocumentType=typeof DOCUMENT_TYPES[number];
export type DocumentSection={id:string;heading:string;brief:string;text:string;authoredBy:'owner'|'agent'|null};
/** One figures line: quantity as decimal text (at most three places), unit and line amounts in minor units (BigInt as text). */
export type DocumentFigureLine={id:string;label:string;quantity:string;unitMinor:string;lineMinor:string};
export type DocumentFigures={currency:string;lines:DocumentFigureLine[];totalMinor:string;receiptId:string;rule:string};
export type DocumentBody={
 orderId:string;clientId:string;docType:DocumentType;title:string;
 sourceFileIds:string[];sourceDigest:string;
 sections:DocumentSection[];figures:DocumentFigures|null;
 /** The digest of the outline, sources and figures the owner approved for AI work, or null. */
 briefApproval:string|null;
 /** The digest of the finished document the owner approved for export, or null. */
 approval:string|null;
 /** The delivery run whose draft filled the sections, or null. */
 takenFromRun:string|null;
};
