// Canonical browser-safe types, shared by the engine and renderer.
import type { ArticleLanguage } from '../../../../shared/venture/playbooks/podcast-to-article/style.ts';
import type { ArticleParagraph } from '../../../../shared/venture/playbooks/podcast-to-article/prep.ts';
import type { ArticleFact } from '../../../../shared/venture/playbooks/podcast-to-article/ledger.ts';

export type ArticleLedgerBody={orderId:string;clientId:string;source:{fileId:string;orderId:string;fingerprint:string;name:string};intakeDigest:string;host:string;guests:string[];language:ArticleLanguage;paragraphs:ArticleParagraph[];facts:ArticleFact[];warnings:string[];angles:ArticleAngle[];selection:{angleId:string;title:string;sections:string[]}|null;draft:ArticleBundle|null;state:'prepared'|'outlined'|'drafted'|'approved';approval:string|null};

export type ArticleAngle={id:string;title:string;reason:string;factIds:string[]};

export type ArticleBundle={title:string;sections:{heading:string;text:string}[];showNotes:string;newsletterBlurb:string};
