// Original portable saved-ledger checks shared by native and browser delivery.
import {digest} from '../../../portable.ts';
type CareerDraftInput={careerPack?:CareerDraftEvidence|null;deliverable:{title:string;sections:readonly {heading:string;parts:readonly {kind:string;text?:string}[]}[];questionsForClient:readonly string[];attachments?:readonly unknown[]}};
export type CareerDraftEvidence={text:string;factsDigest:string;currentFactsDigest:string;ownerApproval:string|null;binding:string};
export const careerDraftCheck=(input:CareerDraftInput)=>{
 const saved=(input as typeof input&{careerPack?:CareerDraftEvidence|null}).careerPack;
 const text=[input.deliverable.title,...input.deliverable.sections.flatMap(s=>[s.heading,...s.parts.flatMap(p=>p.kind==='text'?[p.text]:[])]),...input.deliverable.questionsForClient].join('\n');
 const current=!!saved&&saved.factsDigest===saved.currentFactsDigest&&saved.ownerApproval===saved.binding&&saved.binding===digest({text:saved.text,factsDigest:saved.factsDigest});
 const exact=current&&!(input.deliverable.attachments?.length)&&input.deliverable.title==='Career pack'&&input.deliverable.sections.length===1&&input.deliverable.sections[0]?.heading==='Approved evidence'&&input.deliverable.sections[0]?.parts.length===1&&input.deliverable.sections[0].parts[0]?.kind==='text'&&input.deliverable.sections[0].parts[0].text===saved.text&&input.deliverable.questionsForClient.length===0;
 return [{playbook:'job-search-desk',check:'only-stated-facts',outcome:exact?'pass' as const:'fail' as const,detail:'The pack must exactly match current owner-reviewed ledger content.'},{playbook:'job-search-desk',check:'no-application-made',outcome:exact&&!/\b(?:we|I|Chausar)\s+(?:have\s+)?(?:applied|submitted|sent your application)\b/i.test(text)?'pass' as const:'fail' as const,detail:'Applications and messages remain a client handoff.'}];
};
