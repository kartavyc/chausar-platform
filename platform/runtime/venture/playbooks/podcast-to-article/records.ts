import type { ArticleLedgerBody, ArticleAngle, ArticleBundle } from '../../../../contract/venture/playbooks/podcast-to-article/records.ts';
export type { ArticleLedgerBody, ArticleAngle, ArticleBundle } from '../../../../contract/venture/playbooks/podcast-to-article/records.ts';
// Chausar playbook: Podcast to articles (Ink v2 wave 5, packages 5L). The bodies of its own records, as contracts.ts
// types each one (RecordBase<kind> & Body). Package 5-0 named each as a placeholder; the package replaces it with the
// record's fields here, never in contracts.ts. Types only. Written for Chausar; nothing here is learned from an outside
// source.

import type {ArticleParagraph} from './prep.ts';
import type {ArticleFact} from './ledger.ts';
import type {ArticleLanguage} from './style.ts';


/** The ledger retains source identity, exact owner direction and one reviewable draft. */

