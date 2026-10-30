// Chausar playbook: Tender and proposal desk (Ink v2 wave 5, packages 5O). The bodies of its own records, as
// contracts.ts types each one (RecordBase<kind> & Body). Package 5-0 named each as a placeholder; the package replaces
// it with the record's fields here, never in contracts.ts. Types only. Written for Chausar; nothing here is learned
// from an outside source.

/** One actual source question and its exact owner approval. */
import type {TenderQuestion,TenderTone} from './questions.ts';
export type TenderPreview={callId:string;payloadText:string;digest:string;presetId:string;model:string|null;endpoint:string;estimatedMaxCostMicros:string;estimatedMaxCostDisplay:string;expiresAt:string;payer?:string};
export type TenderSourceSelection={rfpFileId:string|null;documentFileIds:string[];issuerFileId:string|null;mapping:{sheet:string;questionColumn:string;answerColumn:string;firstRow:number;lastRow:number}|null};
export type TenderQuestionBody={orderId:string;clientId:string;sourceDigest:string;selection:TenderSourceSelection;question:TenderQuestion;controls:{lengthWords:number;tone:TenderTone};approval:string|null;aiRequest:{preview:TenderPreview;binding:string}|null;aiCallIds:string[]};
