// Chausar playbook: the sign-off desk (wave 6, 6E5). Pure profession data shared by the engine and the browser fake:
// who signs each offer's papers (the licensed professional and the number that identifies them), what each regulator
// switches off (tools refused in code), the draft words a regulator forbids (refused by the regulator-limits check),
// and the rules behind them. A rule is marked checked only when Chausar read it on the regulator's own page, with the
// link and the day; every other rule says unchecked. No setting or attestation unlocks any of it (DECISIONS D21).
// Written for Chausar; nothing here is learned from an outside source.

export const SIGNOFF_PROFESSIONS=['advocate','doctor','financial-planner','company-secretary','chartered-accountant'] as const;
export type SignoffProfession=typeof SIGNOFF_PROFESSIONS[number];
/** Tools a regulator can switch off. outreach and advertising are the engine's own switches (core/compliance.ts). */
export const SIGNOFF_TOOLS=['outreach','advertising'] as const;
export type SignoffTool=typeof SIGNOFF_TOOLS[number];

/**
 * One rule behind a limit. url is the regulator's own page; checked is true only when the rule text was read there on
 * readOn (W6 F4: each rule keeps its own day; SIGNOFF_RULES_READ_ON is the first).
 */
export type SignoffRule={id:string;profession:SignoffProfession;topic:string;title:string;line:string;url:string;checked:boolean;readOn:string};
export type ProfessionSpec={
 id:SignoffProfession;label:string;
 /** Who signs, inside a sentence: "your advocate". */
 signer:string;
 /** The number the professional types to sign, and its shape. */
 registry:{label:string;pattern:RegExp;hint:string};
 /** The playbook offer whose papers this professional signs. */
 offer:string;
 refusedTools:readonly {tool:SignoffTool;line:string;ruleId:string}[];
 refusedWords:readonly {id:string;pattern:RegExp;line:string;ruleId:string}[];
};

/** The day Chausar first read (or tried to read) each rule on its regulator's page. */
export const SIGNOFF_RULES_READ_ON='2026-11-01';
/** W6 F4: the day BCI Rule 36 and the Telemedicine Guidelines were read on their official sources. */
const REREAD_ON='2026-11-02';
export const SIGNOFF_RULES:readonly SignoffRule[]=Object.freeze([
 {id:'bci-rule-36',profession:'advocate',topic:'Advocates and solicitation',title:'Bar Council of India Rules, Part VI, Chapter II, Section IV, Rule 36',line:'An advocate does not solicit work or advertise, directly or indirectly.',url:'https://www.barcouncilofindia.org/info/bar-counci-g36acc',checked:true,readOn:REREAD_ON},
 {id:'nmc-2002-6-1-1',profession:'doctor',topic:'Doctors and soliciting patients',title:'Code of Medical Ethics Regulations, 2002, clause 6.1.1',line:'Soliciting patients, directly or indirectly, is unethical.',url:'https://www.nmc.org.in/page/rules-regulations-rules-regulations-of-erstwhile-mci-code-of-medical-ethics-regulations-2002',checked:true,readOn:SIGNOFF_RULES_READ_ON},
 {id:'nmc-2002-1-4-1',profession:'doctor',topic:'Registration number on prescriptions',title:'Code of Medical Ethics Regulations, 2002, clause 1.4.1',line:'A prescription carries the doctor\'s registration number.',url:'https://www.nmc.org.in/page/rules-regulations-rules-regulations-of-erstwhile-mci-code-of-medical-ethics-regulations-2002',checked:true,readOn:SIGNOFF_RULES_READ_ON},
 {id:'telemedicine-2020',profession:'doctor',topic:'Who counsels and prescribes',title:'Telemedicine Practice Guidelines, 2020, sections 5.4 and 3.2.5',line:'Only a registered medical practitioner counsels patients or prescribes; an AI tool does not.',url:'https://esanjeevani.mohfw.gov.in/assets/guidelines/Telemedicine_Practice_Guidelines.pdf',checked:true,readOn:REREAD_ON},
 {id:'sebi-ia-2013',profession:'financial-planner',topic:'Investment advice',title:'SEBI (Investment Advisers) Regulations, 2013',line:'Investment advice needs a SEBI registration; returns are never assured.',url:'https://www.sebi.gov.in/legal/regulations/',checked:false,readOn:SIGNOFF_RULES_READ_ON},
 {id:'sebi-ra-2014',profession:'financial-planner',topic:'Research calls and target prices',title:'SEBI (Research Analysts) Regulations, 2014',line:'Buy or sell calls and target prices need a research analyst registration.',url:'https://www.sebi.gov.in/legal/regulations/',checked:false,readOn:SIGNOFF_RULES_READ_ON},
 {id:'cs-act-1980',profession:'company-secretary',topic:'Company secretaries and advertising',title:'Company Secretaries Act, 1980, First Schedule',line:'A company secretary in practice does not solicit clients by advertisement.',url:'https://www.icsi.edu/',checked:false,readOn:SIGNOFF_RULES_READ_ON},
 {id:'ca-act-1949',profession:'chartered-accountant',topic:'Chartered accountants and advertising',title:'Chartered Accountants Act, 1949, First Schedule',line:'A chartered accountant in practice does not solicit clients by advertisement.',url:'https://resource.cdn.icai.org/75789ca-act-61309.pdf',checked:false,readOn:SIGNOFF_RULES_READ_ON},
]);

export const PROFESSION_SPECS:readonly ProfessionSpec[]=Object.freeze([
 {id:'advocate',label:'Advocate',signer:'your advocate',offer:'legal-drafting',
  registry:{label:'Bar Council enrolment number',pattern:/^[A-Z]{1,5}\/\d{1,6}\/\d{4}$/,hint:'As on the enrolment certificate, for example MAH/1234/2015.'},
  refusedTools:[{tool:'outreach',line:'Advocates do not solicit clients, so outreach is switched off.',ruleId:'bci-rule-36'},{tool:'advertising',line:'Advocates do not advertise, so promotional posts are switched off.',ruleId:'bci-rule-36'}],
  refusedWords:[{id:'solicits',pattern:/\b(?:hire|retain|choose) (?:me|us)\b|\bbest (?:lawyer|advocate|law firm)s?\b|\bguaranteed? (?:win|success|outcome|result)s?\b|\bno win,? no fee\b|\bsuccess rate\b/i,line:'The draft solicits work or promises an outcome, which advocates may not do.',ruleId:'bci-rule-36'}]},
 {id:'doctor',label:'Doctor',signer:'your doctor',offer:'clinic-follow-up',
  registry:{label:'Medical registration number',pattern:/^[A-Z0-9][A-Z0-9/-]{2,19}$/,hint:'As issued by the medical council.'},
  refusedTools:[{tool:'outreach',line:'Doctors do not solicit patients, so outreach is switched off.',ruleId:'nmc-2002-6-1-1'},{tool:'advertising',line:'Doctors do not solicit patients, so promotional posts are switched off.',ruleId:'nmc-2002-6-1-1'}],
  refusedWords:[{id:'diagnosis',pattern:/\bdiagnos(?:is|ed|e|ing)\b|\bsuffering from\b|\byou (?:have|may have|might have|likely have|probably have) (?:an? )?(?:\w+ )?(?:infection|disease|disorder|syndrome|deficiency|fracture|cancer|diabetes|hypertension|fever|allergy)\b/i,line:'AI text never diagnoses. Only your doctor tells a patient what they have.',ruleId:'telemedicine-2020'},
   {id:'prescription',pattern:/\bprescri(?:be|bed|bing|ption)\b|\b\d+(?:\.\d+)?\s?(?:mg|mcg|ml)\b|\b(?:once|twice|thrice) (?:a|per) day\b|\b(?:take|start|stop|increase|reduce) (?:the |this |your )?(?:tablet|capsule|medicine|medication|dose|syrup)s?\b/i,line:'AI text never prescribes. Only your doctor writes medicines and doses.',ruleId:'telemedicine-2020'}]},
 {id:'financial-planner',label:'Financial planner',signer:'your SEBI-registered adviser',offer:'review-pack',
  registry:{label:'SEBI registration number',pattern:/^IN[AH]\d{9}$/,hint:'An adviser number starts INA, a research analyst number INH.'},
  refusedTools:[],
  refusedWords:[{id:'tips',pattern:/\btarget price\b|\bstop[- ]?loss\b|\bmulti-?bagger\b|\b(?:guaranteed|assured|promised|fixed) returns?\b|\bwill (?:double|triple)\b|\b(?:buy|sell|accumulate|exit)\b[^.\n]{0,40}\b(?:at|above|below|before)\b[^.\n]{0,12}\d/i,line:'The draft gives a stock tip, a target price or a promised return, which Chausar never writes.',ruleId:'sebi-ra-2014'}]},
 {id:'company-secretary',label:'Company secretary',signer:'your company secretary',offer:'secretarial-papers',
  registry:{label:'ICSI membership number',pattern:/^[AF]CS\d{3,6}$/,hint:'For example ACS 12345 or FCS 1234.'},refusedTools:[],refusedWords:[]},
 {id:'chartered-accountant',label:'Chartered accountant',signer:'your CA',offer:'tax-papers',
  registry:{label:'ICAI membership number',pattern:/^\d{6}$/,hint:'Six digits.'},refusedTools:[],refusedWords:[]},
]);

export function professionSpec(id:unknown):ProfessionSpec|null{return PROFESSION_SPECS.find(spec=>spec.id===id)??null;}
export function professionOfOffer(offer:unknown):ProfessionSpec|null{return PROFESSION_SPECS.find(spec=>spec.offer===offer)??null;}
/** A typed registration number as stored and compared: upper case, no spaces. */
export function registrationKey(value:unknown):string{return typeof value==='string'?value.replace(/\s+/g,'').toUpperCase():'';}

/** The first regulator limit the draft text breaks, or null. */
export function forbiddenWords(spec:ProfessionSpec,text:string):{id:string;line:string;ruleId:string}|null{
 for(const words of spec.refusedWords)if(words.pattern.test(text))return {id:words.id,line:words.line,ruleId:words.ruleId};
 return null;
}

/** The gate's words with the signer named. */
export function signoffWords(spec:Pick<ProfessionSpec,'signer'>){
 const who=spec.signer,Who=who.charAt(0).toUpperCase()+who.slice(1);
 return Object.freeze({
  noSigner:`These are regulated papers. Name ${who}, who signs them before you accept or share them.`,
  outline:`An outline is never signed. Draft these papers with your AI; ${who} signs them before you accept or share them.`,
  notSent:`These regulated papers have not gone to ${who} yet. Send them to sign before you accept or share them.`,
  sent:`These regulated papers are with ${who}, waiting for the signature.`,
  returned:`${Who} returned these papers, so they cannot be accepted or shared. Draft them again.`,
  changed:`${Who} signed a different version of these papers. Only the signed papers can be accepted or shared.`,
  editNotSent:`You edited these regulated papers, and your edit has not gone to ${who} yet. Send it to sign first.`,
  editSent:`Your edit of these regulated papers is with ${who}, waiting for the signature.`,
 });
}
