// Original Chausar screening code; three-state evidence and experience-union ideas from jev-recruiter (MIT).
export class RecruitError extends Error { code:string;constructor(code:string,message:string){super(message);this.code=code;this.name='RecruitError';} }
export function need(ok:unknown,code:string,message:string):asserts ok {if(!ok)throw new RecruitError(code,message);}
export type Criterion={id:string;text:string;required:boolean;verify:string};
export type Excerpt={id:string;text:string};
export type Finding={criterionId:string;status:'met'|'not_met'|'unknown';excerptId:string|null;quote:string|null};
const PROTECTED=/\b(?:age|aged|birth(?:day|\s+year)?|born|gender|sex|sexuality|sexual\s+orientation|males?|females?|women|men|pronouns?|marital|married|unmarried|pregnan\w*|religio\w*|hindu|muslim|christian|sikh|caste|disabil\w*|photograph|photo|race|ethnic\w*|nationality|citizens?hip|citizens?|young|elderly|family\s+status|home\s+address|date\s+of\s+birth)\b|\bgraduat\w*\s+(?:year|(?:in\s+)?(?:19|20)\d{2})|\b(?:recent|fresh)\s+graduat\w*|\b(?:under|over|below|above)\s+\d{2}\b|\b\d+\s+years?\s+old\b|(?:महिला|पुरुष|लड़की|लड़का|उम्र|आयु|जन्म|जाति|धर्म|लिंग|गर्भवती|अविवाहित|विवाहित|विकलांग)/iu;
const plain=(text:string)=>text.normalize('NFKC').replace(/\p{Cf}/gu,'');
/** Criteria and sourcing rules may describe professional requirements only. */
export function assertJobRelated(text:string):void {need(typeof text==='string'&&!PROTECTED.test(plain(text)),'PROTECTED_TRAIT','Use job-related skills and evidence only. Protected traits and their proxies are not screening rules.');}
/** Keep professional lines only; protected information never becomes a candidate field or excerpt. */
export function professionalText(text:string):string {return text.split(/\r?\n/).filter(line=>!PROTECTED.test(plain(line))).join('\n').trim();}
/** Resolve selected evidence from the supplied source. A missing or changed quote cannot support any verdict. */
export function screenCriteria(input:{criteria:readonly Criterion[];resume:string;excerpts:readonly Excerpt[];findings:readonly {criterionId:string;status:string;excerptId:string|null}[]}){
 need(Array.isArray(input.criteria)&&input.criteria.length>0&&input.criteria.length<=20,'INVALID_VENTURE_REQUEST','Give up to twenty job criteria.');
 need(typeof input.resume==='string'&&input.resume.length<=100000&&Array.isArray(input.excerpts)&&input.excerpts.length<=100&&Array.isArray(input.findings)&&input.findings.length<=20,'INVALID_VENTURE_REQUEST','Give bounded resume evidence and one finding per criterion.');
 const ids=new Set<string>();for(const criterion of input.criteria){need(criterion&&typeof criterion.id==='string'&&/^[a-z0-9-]{1,64}$/.test(criterion.id)&&!ids.has(criterion.id)&&typeof criterion.text==='string'&&criterion.text.trim().length>0&&criterion.text.length<=1000&&typeof criterion.verify==='string'&&!!criterion.verify.trim()&&typeof criterion.required==='boolean','INVALID_VENTURE_REQUEST','Each criterion needs a unique ID, its requirement and how to verify it.');assertJobRelated(criterion.text+' '+criterion.verify);ids.add(criterion.id);}
 const seen=new Set<string>();for(const finding of input.findings){need(ids.has(finding.criterionId)&&!seen.has(finding.criterionId)&&['met','not_met','unknown'].includes(finding.status)&&(finding.excerptId===null||typeof finding.excerptId==='string'),'INVALID_VENTURE_REQUEST','Choose met, not met or unknown once for each criterion.');seen.add(finding.criterionId);}
 const excerptIds=new Set<string>();for(const excerpt of input.excerpts){need(excerpt&&typeof excerpt.id==='string'&&!!excerpt.id&&typeof excerpt.text==='string'&&excerpt.text.length<=2000&&!excerptIds.has(excerpt.id),'INVALID_VENTURE_REQUEST','Each excerpt needs a unique ID and bounded source text.');excerptIds.add(excerpt.id);}
 const safe=professionalText(input.resume);
 const findings:Finding[]=input.criteria.map(criterion=>{const proposed=input.findings.find(f=>f.criterionId===criterion.id),excerpt=input.excerpts.find(e=>e.id===proposed?.excerptId);const valid=!!excerpt?.text.trim()&&safe.includes(excerpt.text)&&professionalText(excerpt.text)===excerpt.text;const status=valid&&proposed?proposed.status as Finding['status']:'unknown';return {criterionId:criterion.id,status,excerptId:status==='unknown'?null:excerpt!.id,quote:status==='unknown'?null:excerpt!.text};});
 const required=findings.filter(f=>input.criteria.find(c=>c.id===f.criterionId)!.required);
 const recommendation=required.some(f=>f.status==='not_met')?'not_a_match':required.every(f=>f.status==='met')?'potential_match':'needs_review';
 const summary= recommendation==='not_a_match'?'The quoted evidence contradicts a required criterion. The owner decides the next step.':recommendation==='potential_match'?'The quoted evidence supports the required criteria. The owner verifies suitability.':'Required evidence is missing or uncertain. Ask for clarification before deciding.';
 return {findings,recommendation,summary};
}
const month=(value:string):number|null=>{const m=/^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);return m?Number(m[1])*12+Number(m[2])-1:null;};
/** Whole calendar months in the union of dated relevant professional roles, inclusive of both endpoint months. */
export function experienceMonths(roles:readonly {start:string;end:string}[],asOf:string):number|null{
 const now=month(asOf);if(now===null||!Array.isArray(roles)||!roles.length||roles.length>100)return null;
 const ranges:{start:number;end:number}[]=[];for(const role of roles){const start=month(role.start),end=role.end.toLowerCase()==='present'?now:month(role.end);if(start===null||end===null||start>end||end>now)return null;ranges.push({start,end});}
 ranges.sort((a,b)=>a.start-b.start);let total=0,start=ranges[0]!.start,end=ranges[0]!.end;for(const next of ranges.slice(1)){if(next.start<=end+1)end=Math.max(end,next.end);else{total+=end-start+1;start=next.start;end=next.end;}}return total+end-start+1;
}
