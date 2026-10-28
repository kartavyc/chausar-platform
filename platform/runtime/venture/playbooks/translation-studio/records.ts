// Chausar playbook: Translation and subtitles (Ink v2 wave 5, packages 5J1, 5J2). The bodies of its own records, as
// contracts.ts types each one (RecordBase<kind> & Body). Package 5-0 named each as a placeholder; the package replaces
// it with the record's fields here, never in contracts.ts. Types only. Written for Chausar; nothing here is learned
// from an outside source.

/** venture-translation-job: a placeholder until package 5J1 lands. */
import type {TranslationState} from './state.ts';
import type {TranslationSegment} from './core.ts';
export type TranslationJobBody = {orderId:string;clientId:string;state:TranslationState};
/** venture-translation-segment: a placeholder until package 5J1 lands. */
export type TranslationSegmentBody = Omit<TranslationSegment,'id'> & {jobId:string;sourceId:string};
/** venture-glossary: a placeholder until package 5J1 lands. */
export type GlossaryBody = TranslationState['glossary'] & {jobId:string;clientId:string};
