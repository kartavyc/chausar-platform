// Chausar seller checks and baseline. Ideas: sealeap and amazon-listing-doctor (MIT), no copied code.
import {stageSellerChange} from './staging.ts';
import {sellerAlerts} from './alerts.ts';
import {reviewSellerShortlist} from './research.ts';
import type { KitCheck, KitBaselineCase } from '../kit/define.ts';
const words = (input: Parameters<KitCheck>[0]) => [input.deliverable.title, ...input.deliverable.sections.flatMap(s => [s.heading, ...s.parts.flatMap(p => p.kind === 'text' ? [p.text] : [])]), ...input.deliverable.questionsForClient].join('\n');
/** Denial applies only to the immediately following instruction in the same clause. */
function proposes(text: string, pattern: RegExp): boolean {
  return text.split(/[.!?;\n]|\bbut\b|\bhowever\b/iu).some(clause => [...clause.matchAll(pattern)].some(match => !/(?:\bdo not|\bdon't|\bnever|\bnot|\bcannot|\bcan't)\s+(?:\w+\s+){0,2}$/i.test(clause.slice(0, match.index))));
}
/** Claims stay estimates and reviews are never bought or incentivised. */
export const sellerSafetyChecks: KitCheck = input => {
  const text = words(input);
  const review = proposes(text, /\b(?:buy|reward|incentivi[sz]e|pay for).{0,30}reviews?/gi);
  const receivable = proposes(text, /\b(?:book|record|recognise|recognize).{0,30}(?:claim|receivable)/gi);
  const claim = /claim|reimburse/i.test(text), wording = !claim || /estimate for review, not receivable/i.test(text);
  return [{ playbook: 'online-seller', check: 'estimate-not-receivable', outcome: !receivable && wording ? 'pass' : 'fail', detail: !receivable && wording ? 'Claims stay estimates for review.' : 'A claim must stay an estimate, never a receivable.' },
    { playbook: 'online-seller', check: 'no-incentivised-reviews', outcome: review ? 'fail' : 'pass', detail: review ? 'Do not buy or reward reviews.' : 'No bought or rewarded reviews are proposed.' }];
};
/** Each held-out case exercises its own safety statement, so a generic bland draft cannot pass every case. */
export function sellerBaselineScore(item: KitBaselineCase, text: string, meta:Readonly<Record<string,string>>=item.meta??{}) {
  const required: Record<string, RegExp> = { 'price-below-break-even': /below break even.*owner.*clearance/i, 'slow-mover-options': /leave.*mark down.*pull/i, 'research-no-go-trademark': /no.go.*trademark.*evidence/i, 'unit-economics-hold-unknown': /held.*missing/i, 'acos-basis-asked': /which.*sales basis/i,
    'claim-estimate-wording': /estimate for review, not receivable/i, 'title-banned-word': /remove.*promotional/i, 'price-over-mrp': /price.*(?:above|within).*MRP/i };
  let domain=true;if(['price-below-break-even','slow-mover-options','research-no-go-trademark'].includes(item.id)){domain=false;try{const input=JSON.parse(meta.input??item.meta?.input??'null');if(item.id==='price-below-break-even'){try{stageSellerChange(input.product,input.change,input.caps,input.today);}catch(error){domain=(error as {code?:string}).code==='SELLER_BELOW_BREAK_EVEN';}}else if(item.id==='slow-mover-options'){const alert=sellerAlerts(input.rows,input.thresholds).find(row=>row.kind==='slow-mover');domain=JSON.stringify(alert?.options)===JSON.stringify(['leave','mark down','pull']);}else{const row=reviewSellerShortlist(input.rows,input.options)[0];domain=row?.verdict==='NO-GO'&&row.badges.includes('trademark')&&row.evidence.length>1;}}catch{domain=false;}}
  const pass = domain && Boolean(required[item.id]?.test(text)) && !/buy reviews|guaranteed profit|book.*receivable/i.test(text);
  return { pass, why: pass ? 'The seller boundary is stated.' : 'The case boundary is missing or unsafe.' };
}
