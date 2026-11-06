// Chausar playbook kit (wave 6, 6E5): the sign-off gate on regulated papers, shared by the CA firm (ca-firm/
// signoff-gate.ts) and the sign-off desk (signoff-desk/gate.ts). Extracted from the CA firm's gate so a named licensed
// professional (a CA, an advocate, a doctor, a SEBI-registered adviser, a company secretary) signs the exact papers a
// client receives: a request covers one digest of a run's papers, the owner's edit is new papers with a digest of its
// own, and only a signed request for the current digest lets the papers be accepted, shared or posted. Pure: no store,
// no clock; the browser fake imports it too. Written for Chausar; nothing here is learned from an outside source.
import { digest } from '../../../portable.ts';

/** The run fields the gate reads. */
export type PapersRun={id:string;status:string;renderedText:string|null;deliverable:unknown;editedText:string|null};

/** The owner's paper edits, including those kept when Accept preserves their exact words. */
export function papersEdit(run:Pick<PapersRun,'status'|'editedText'>):string|null{return (run.status==='edited'||run.status==='accepted')&&run.editedText?run.editedText:null;}

/** The digest the professional signs: the run's papers as they would go out. The owner's edit has a digest of its own. */
export function papersDigestOf(run:PapersRun):string{
 const edit=papersEdit(run);
 return edit!==null?digest({runId:run.id,text:edit,edited:true}):digest({runId:run.id,text:run.renderedText,deliverable:run.deliverable});
}

/**
 * Where a run's papers stand. not-needed: no sign-off needed. outline: a template outline, never sent. no-signer: no
 * professional of record. not-asked: no request for these papers yet. unsent: asked, not sent. sent: with the
 * professional. returned: returned. changed: the professional signed other papers of this run. signed: these papers.
 */
export type GateStage='not-needed'|'outline'|'no-signer'|'not-asked'|'unsent'|'sent'|'returned'|'changed'|'signed';

/** What the gate needs to know about one regulated run; requests are this run's, oldest first. */
export type GateFacts={
 edited:boolean;servedByModel:boolean;wanted:string;hasSigner:boolean;
 requests:readonly {id:string;workingDigest:string}[];
 decision(requestId:string):'signed'|'returned'|null;
 sent(requestId:string):boolean;
};

/** The stage of a regulated run's papers (the caller answers not-needed for papers that need no sign-off). */
export function gateStage(facts:GateFacts):GateStage{
 // A template outline never read the client's request, so it is never sent; the owner's edit of one is.
 if(!facts.edited&&!facts.servedByModel)return 'outline';
 const request=facts.requests.filter(item=>item.workingDigest===facts.wanted).at(-1);
 const decided=request?facts.decision(request.id):null;
 if(decided)return decided==='signed'?'signed':'returned';
 if(!facts.hasSigner)return 'no-signer';
 if(request)return facts.sent(request.id)?'sent':'unsent';
 return !facts.edited&&facts.requests.some(item=>facts.decision(item.id)==='signed')?'changed':'not-asked';
}

/** The owner's words for each stage that holds the papers. */
export type GateWords={noSigner:string;outline:string;notSent:string;sent:string;returned:string;changed:string;editNotSent:string;editSent:string};

/** Why the papers cannot be accepted, shared or posted yet, or null when they can. */
export function gateBlock(stage:GateStage,edited:boolean,words:GateWords):string|null{
 switch(stage){
  case 'not-needed':case 'signed':return null;
  case 'outline':return words.outline;
  case 'no-signer':return words.noSigner;
  case 'returned':return words.returned;
  case 'changed':return words.changed;
  case 'sent':return edited?words.editSent:words.sent;
  default:return edited?words.editNotSent:words.notSent;
 }
}
