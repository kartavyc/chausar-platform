// Original source reader and manual portal handoff catalogue. No portal credentials or automated submission.
import type { CatalogueEntry } from '../catalogue.ts';

export const TENDER_DESK_CATALOGUE: readonly CatalogueEntry[] = Object.freeze([
 {id:'tender-documents',name:'Tender source documents',category:'docs-ops',auth:'Owner-supplied files for the current client order',regions:['india','global'],regionNote:null,note:'Reads separate client evidence and RFP sources. Spreadsheet questions require a column map; readable PDFs use the desktop reader.',vendorUrl:null,targets:['read']},
 {id:'tender-submission',name:'Tender submission handoff',category:'docs-ops',auth:'The owner uses their portal or mail account',regions:['india','global'],regionNote:null,note:'Exports the exact approved response pack. The owner submits on GeM, CPPP, a state portal or email. Chausar never logs in or submits.',vendorUrl:null,targets:['handoff']}
]);
