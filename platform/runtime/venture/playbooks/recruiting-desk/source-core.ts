// Original browser-safe recruiting source checks. Only professional evidence reaches the candidate ledger.
import {need,professionalText,experienceMonths} from './criteria.ts';
import {RECRUITING_RULES} from './rules.ts';
import {ruleCleared,type AttestedRules} from '../kit/attestation.ts';
export function candidateExperience(resume:string,asOf:string):number|null {const work=resume.split(/\r?\n/).filter(line=>/^\s*(?:Work|Employment|काम|नौकरी)\s*:/i.test(line));if(!work.length)return null;const roles=work.map(line=>/\b(\d{4}-\d{2})\s+(?:to|through|से|[-–])\s+(\d{4}-\d{2}|present)\b/i.exec(line));if(roles.some(role=>!role))return null;return experienceMonths(roles.map(m=>({start:m![1]!,end:m![2]!})),asOf.slice(0,7));}
export function sourceResume(text:unknown){need(typeof text==='string'&&text.length>0&&text.length<=100000,'INVALID_VENTURE_REQUEST','Paste a bounded professional resume.');const safe=professionalText(text);need(safe.length>0,'RECRUIT_SOURCE_REQUIRED','Add professional resume evidence.');return safe;}
/** Live personal-data processing waits for the dated professional review; practice uses fictional evidence. */
/** W6 6C5: or the owner attested the candidate privacy rule (these exact words, not withdrawn). */
export function recruitPrivacyReady(launchStage:unknown,attested?:AttestedRules){need(launchStage==='rehearsal'||launchStage==='shadow'||ruleCleared(RECRUITING_RULES.find(rule=>rule.id==='candidate-privacy')!,attested),'RULE_UNCONFIRMED','A lawyer must confirm the client privacy purpose and notice before live candidate work. Use fictional practice evidence or handle the client work manually meanwhile.');}
