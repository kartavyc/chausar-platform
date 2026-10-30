// Chausar connector catalogue: the podcast-to-article playbook's own entries (Podcast to articles; Ink v2 wave 5,
// packages 5L). Package 5-0 left it empty; the package adds its connectors here, never in build/catalogue.ts. Import
// only types from catalogue.ts: it loads this file while it is still being set up (build/catalogue-playbooks.ts).
// Written for Chausar; nothing here is learned from an outside source.
import type { CatalogueEntry } from '../catalogue.ts';

export const PODCAST_TO_ARTICLE_CATALOGUE: readonly CatalogueEntry[] = Object.freeze([
 {id:'article-transcript',name:'Episode transcript',category:'docs-ops',auth:'An owner-supplied source file',regions:['india','global'],regionNote:null,note:'Reads SRT, VTT or TXT supplied by the owner. Reuse is limited to the same client.',vendorUrl:null,targets:['read']},
 {id:'article-local-transcription',name:'Local episode transcription',category:'docs-ops',auth:'Owner-installed ffmpeg and whisper.cpp',regions:['india','global'],regionNote:null,note:'Desktop only. Copies approved local video or audio up to 50 MB before transcription. Nothing is installed or uploaded; add a transcript for larger episodes or missing tools.',vendorUrl:null,targets:['read']},
 {id:'article-publishing',name:'Article publishing handoff',category:'docs-ops',auth:'The owner uses the client publishing account',regions:['india','global'],regionNote:null,note:'Copy the exact approved article, show notes and newsletter text. The owner publishes manually; no publishing API is called.',vendorUrl:null,targets:['handoff']},
]);
