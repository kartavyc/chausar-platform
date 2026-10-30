// Chausar playbook: Translation and subtitles (Ink v2 wave 5, package 5J1). The registry entry, with no runtime
// imports. Package 5-0 left it null, so the playbook is not registered and has no tile; the package sets its id
// ('translation-studio'), label, service type, picks, summary, risk level and review day (the plan's "Registration"
// line). Written for Chausar; nothing here is learned from an outside source.
import type { PlaybookRegistration } from '../registry.ts';

export const TRANSLATION_STUDIO_REGISTRATION: PlaybookRegistration = Object.freeze({id:'translation-studio',label:'Translation and subtitles',serviceType:'studio',picks:['translation service','translation agency','subtitling','subtitles for','hindi subtitles','dubbing service','localisation service','localization service','translation studio'],summary:'Agents translate documents and subtitle videos with your client\'s locked glossary; code checks every term and format, and you approve every deliverable.',riskLevel:'medium',lastReviewed:'2026-10-28'});
