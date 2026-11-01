// Chausar playbook: the sign-off desk (wave 6, 6E5). Its dated rules, made from the regulator rules in professions.ts:
// read 'official' only for a rule whose text Chausar read on the regulator's own page, 'unconfirmed' otherwise (the
// page refused the reader or did not show the text). needs is null: the professional's signature, not an attestation,
// is what every client output waits for, and the regulator limits never unlock. Written for Chausar.
import type {DatedRule} from '../kit/rule-type.ts';
import {SIGNOFF_RULES,SIGNOFF_RULES_READ_ON} from './professions.ts';

export const SIGNOFF_DESK_RULES:readonly DatedRule[]=Object.freeze([
 {id:'signoff-every-output',scope:'house',topic:'Signature before any client output',rule:'Every client output waits for the named professional of record to sign its exact papers.',sources:[],checkedOn:SIGNOFF_RULES_READ_ON,read:'house',how:'Code compares the signed digest with the papers at accept, share and post.',usedBy:['signoff'],limitations:'A signature in Chausar is not a filing, a stamp or a portal signature.',needs:null},
 ...SIGNOFF_RULES.map((rule):DatedRule=>({id:rule.id,scope:rule.profession,topic:rule.topic,rule:rule.line,sources:[{title:rule.title,url:rule.url}],checkedOn:SIGNOFF_RULES_READ_ON,read:rule.checked?'official':'unconfirmed',
  how:rule.checked?'Read on the regulator\'s own page.':'The regulator\'s page did not show the rule text to Chausar\'s reader, so it is not confirmed.',usedBy:['check'],limitations:'Chausar does not give legal, medical or investment advice; the professional decides.',needs:null})),
]);
