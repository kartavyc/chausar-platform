// Chausar playbook: the sign-off desk (wave 6, 6E5). The regulator-limits check refuses a draft that holds words its
// profession's regulator forbids (an AI diagnosis or prescription, a solicitation, a stock tip or promised return). A
// failed check blocks Accept; no setting or attestation passes it. Written for Chausar.
import type {KitBaselineCase,KitCheckResult} from '../kit/define.ts';
import type {Deliverable} from '../../contracts.ts';
import {forbiddenWords,professionOfOffer,PROFESSION_SPECS} from './professions.ts';

/** Every word of a draft a client would read: title, headings and text parts. */
export function draftText(deliverable:Pick<Deliverable,'title'|'sections'>):string{
 return [deliverable.title,...deliverable.sections.flatMap(section=>[section.heading,...section.parts.flatMap(part=>part.kind==='text'?[part.text]:[])])].join('\n');
}

/** The first limit the text breaks for this offer's profession; an offer outside the desk is held to every profession's limits. */
export function regulatorFinding(offerKey:string|null,text:string){
 const spec=professionOfOffer(offerKey);
 for(const item of spec?[spec]:PROFESSION_SPECS){const found=forbiddenWords(item,text);if(found)return found;}
 return null;
}

export function signoffChecks(input:{offerKey:string|null;deliverable:Pick<Deliverable,'title'|'sections'>}):KitCheckResult[]{
 const found=regulatorFinding(input.offerKey,draftText(input.deliverable));
 return [{playbook:'signoff-desk',check:'regulator-limits',outcome:found?'fail':'pass',detail:found?found.line:'No words the regulator forbids.'}];
}

export function scoreSignoffBaseline(item:KitBaselineCase,draft:string,meta:Readonly<Record<string,string>>){
 const found=regulatorFinding(meta.offer??null,meta.text??'');
 const actual=found?found.id:'clean';
 return {pass:actual===draft,why:'The regulator-limits check decides by code.'};
}
