// Chausar playbook: Podcast to articles (Ink v2 wave 5, packages 5L). The bodies of its own records, as contracts.ts
// types each one (RecordBase<kind> & Body). Package 5-0 named each as a placeholder; the package replaces it with the
// record's fields here, never in contracts.ts. Types only. Written for Chausar; nothing here is learned from an outside
// source.

import type {ArticleParagraph} from './prep.ts';
import type {ArticleFact} from './ledger.ts';
import type {ArticleLanguage} from './style.ts';
export type ArticleAngle={id:string;title:string;reason:string;factIds:string[]};
export type ArticleBundle={title:string;sections:{heading:string;text:string}[];showNotes:string;newsletterBlurb:string};
/** The ledger retains source identity, exact owner direction and one reviewable draft. */
export type ArticleLedgerBody={orderId:string;clientId:string;source:{fileId:string;orderId:string;fingerprint:string;name:string};intakeDigest:string;host:string;guests:string[];language:ArticleLanguage;paragraphs:ArticleParagraph[];facts:ArticleFact[];warnings:string[];angles:ArticleAngle[];selection:{angleId:string;title:string;sections:string[]}|null;draft:ArticleBundle|null;state:'prepared'|'outlined'|'drafted'|'approved';approval:string|null};
