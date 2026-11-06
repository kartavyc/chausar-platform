import type { TenderSourceSelection, TenderQuestionBody, TenderPreview } from '../../../../contract/venture/playbooks/tender-desk/records.ts';
export type { TenderSourceSelection, TenderQuestionBody, TenderPreview } from '../../../../contract/venture/playbooks/tender-desk/records.ts';
// Chausar playbook: Tender and proposal desk (Ink v2 wave 5, packages 5O). The bodies of its own records, as
// contracts.ts types each one (RecordBase<kind> & Body). Package 5-0 named each as a placeholder; the package replaces
// it with the record's fields here, never in contracts.ts. Types only. Written for Chausar; nothing here is learned
// from an outside source.

/** One actual source question and its exact owner approval. */
import type {TenderQuestion,TenderTone} from './questions.ts';



