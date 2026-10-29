// Manual article handoff, with its ledger and explicit evidence limits. Original Chausar renderer.
import type {ArticleLedgerBody} from './records.ts';
import {articleDeliveryNote} from './notes.ts';
import {requireArticle} from './core.ts';
export function articleApprovalInput(record:ArticleLedgerBody){return {source:record.source,intake:record.intakeDigest,selection:record.selection,draft:record.draft};}
export function articleHandoff(record:ArticleLedgerBody){requireArticle(record.draft,'ARTICLE_DRAFT_REQUIRED','Save an article draft first.');const draft=record.draft,note=articleDeliveryNote(record);return {sent:false,published:false,text:['# '+draft.title,...draft.sections.flatMap(s=>['## '+s.heading,s.text]),'## Show notes',draft.showNotes,'## Newsletter blurb',draft.newsletterBlurb,'## Delivery note','Perspective: '+note.perspective,note.backgroundAdded,note.factsNotVerified,...note.manualChecks,...note.framesToCapture.map(f=>f.timecode+' '+f.source+': '+f.line),'## Source ledger',...record.facts.map(f=>'['+f.id+'] '+(f.timecode??'[time unknown]')+' '+(f.speaker??'Speaker unverified')+': '+f.text)].join('\n\n'),note};}
