// Chausar playbook: the document desk (wave 6, 6E4). Browser-safe registration only.
import type {PlaybookRegistration} from '../registry.ts';

export const DOCUMENT_DESK_ID='document-desk';
export const DOCUMENT_DESK_REGISTRATION:PlaybookRegistration=Object.freeze({id:DOCUMENT_DESK_ID,label:'Document desk',serviceType:'consulting',
 picks:Object.freeze(['document desk','employee handbook','hr handbook','sop writing','standard operating procedure','detailed project report','project report','cma report','cma data','cost estimate','estimate preparation','thesis editing','technical writing','technical writer']),
 summary:'Agents draft handbooks, SOPs, project reports, estimates, thesis edits and technical documents from the client\'s own files; code computes every figure, and you approve and send each document.',
 riskLevel:'medium',lastReviewed:'2026-11-01'});
