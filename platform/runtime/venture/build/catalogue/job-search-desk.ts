// Chausar connector catalogue: the job-search-desk playbook's own entries (Job-search and career desk; Ink v2 wave 5,
// packages 5I). Package 5-0 left it empty; the package adds its connectors here, never in build/catalogue.ts. Import
// only types from catalogue.ts: it loads this file while it is still being set up (build/catalogue-playbooks.ts).
// Written for Chausar; nothing here is learned from an outside source.
import type { CatalogueEntry } from '../catalogue.ts';

export const JOB_SEARCH_DESK_CATALOGUE: readonly CatalogueEntry[] = Object.freeze([
 {id:'career-links',name:'Client job links',category:'docs-ops',auth:'No sign-in. The owner approves each public address.',regions:['india','global'],regionNote:null,note:'Reads complete public static listings under site rules and robots. Paste LinkedIn or Naukri text manually. Live client work waits for the named privacy review.',vendorUrl:null,targets:['read']},
 {id:'career-boards',name:'Public job boards',category:'docs-ops',auth:'Public Greenhouse, Lever or Ashby company board. No client account.',regions:['india','global'],regionNote:null,note:'Reads a bounded public index. Open or paste each complete listing before treating it as read evidence.',vendorUrl:null,targets:['read']},
 {id:'career-pinloop',name:'Your Pinloop account',category:'docs-ops',auth:'The client uses their own account outside Chausar.',regions:['india','global'],regionNote:null,note:'Copy the reviewed shortlist yourself. Chausar never signs in or applies.',vendorUrl:null,targets:['handoff']},
 {id:'career-linkedin',name:'LinkedIn manual path',category:'docs-ops',auth:'The client uses their own account outside Chausar.',regions:['india','global'],regionNote:null,note:'Paste the job text into the desk. The client sends and applies on LinkedIn.',vendorUrl:null,targets:['handoff']},
 {id:'career-naukri',name:'Naukri manual path',category:'docs-ops',auth:'The client uses their own account outside Chausar.',regions:['india','global'],regionNote:null,note:'Paste the job text into the desk. No automated access, sign-in or application.',vendorUrl:null,targets:['handoff']},
]);
