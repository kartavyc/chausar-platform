// Chausar SEO checks. GEOHub (AGPL, ideas only) and seo-agent (MIT); rebuilt independently.
import { createHash } from 'node:crypto';
import { lintArticle } from './lint.ts';
import type { KitCheck } from '../kit/define.ts';
/** Promises of rankings or citations are refused; explicit disclaimers do not become promises. */
export function promisesRanking(words: string): boolean {
    for (const clause of words.split(/[.!?\n।;]|\bbut\b|\bhowever\b/iu)) {
        for (const match of clause.matchAll(/\b(?:guarantee(?:d)?|promise(?:d)?|assur(?:e|ed))\b/gi)) {
            const at = match.index!;
            const before = clause.slice(0, at), after = clause.slice(at + match[0].length);
            const denied = /(?:\b(?:do not|does not|did not|cannot|can't|never|not)\s+(?:\w+\s+){0,2}|\bno\s+(?:ranking|citation|traffic)(?:\s+or\s+(?:ranking|citation|traffic))?\s+is\s+)$/i.test(before) || /^\s+(?:is\s+)?(?:not|never)\b/i.test(after);
            if (!denied && /\b(?:rank\w*|citation\w*|traffic)\b/i.test(clause.slice(Math.max(0, at - 70), at + match[0].length + 70)))
                return true;
        }
        if (/(?:रैंक(?:िंग)?|पहला स्थान|ट्रैफिक|उद्धरण)/u.test(clause) && /(?:गारंटी|पक्का)/u.test(clause) && !/(?:गारंटी|पक्का)[^।]{0,15}नहीं|नहीं[^।]{0,15}(?:गारंटी|पक्का)/u.test(clause))
            return true;
    }
    return false;
}
/** Draft checks never treat a promised ranking as a deliverable. */
export const seoDraftChecks: KitCheck = input => {
    const words = input.deliverable.sections.flatMap(section => section.parts.flatMap(part => part.kind === 'text' ? [part.text] : [])).join(' ');
    return [{ playbook: 'seo-visibility', check: 'no-ranking-promise', outcome: promisesRanking(words) ? 'fail' : 'pass', detail: promisesRanking(words) ? 'The draft promises a ranking or citation.' : 'No ranking or citation is promised.' }];
};
/** The held-back baseline checks case-specific evidence boundaries as well as the promise ban. */
export function scoreSeoBaseline(id: string, draft: string): {
    pass: boolean;
    why: string;
} {
    const requirements: Record<string, RegExp[]> = {
        'clinic-visibility-check': [/source gaps?[^.!?]{0,35}unknown/i, /fix/i, /evidence/i],
        'blocked-training-bot-only': [/training/i, /separate/i, /search/i, /does not prove/i],
        'empty-without-js': [/empty without JavaScript/i, /HTML/i],
        'panel-not-enough-data': [/not enough data/i, /missing/i, /denominator/i],
        'promise-ranking-refused': [/refused/i, /no forecast/i],
        'article-uncorroborated-number': [/uncorroborated[^.!?]{0,25}number[^.!?]{0,25}refused/i,/two independent sources/i,/claim marker/i],
        'local-page-four-elements': [/local programme/i,/local case/i,/landmark/i,/price or logistics/i,/generic page[^.!?]{0,25}fails/i],
        'refresh-plan-not-edit': [/title and meta/i,/depth rewrite/i,/content gap/i,/consolidation/i,/AI-overview/i,/plan only/i,/no live edit/i],
    };
    const expected = requirements[id];
    const pass = Boolean(expected) && expected!.every(pattern => pattern.test(draft)) && !promisesRanking(draft);
    return { pass, why: pass ? 'The case evidence and limits are stated.' : 'The draft omits a case boundary or promises results.' };
}

const articleWords=(input:Parameters<KitCheck>[0])=>input.deliverable.sections.flatMap(s=>s.parts.flatMap(p=>p.kind==='text'?[p.text]:[])).join('\n');
const isArticle=(input:Parameters<KitCheck>[0])=>(input.offerKey==='content-retainer'||input.offerKey==='local-seo')&&(input.stageId??'write')==='write';
/** Successful code corroboration must cover the exact draft currently under review. */
export const seoClaimChecks:KitCheck=input=>{
 if(!isArticle(input))return [{playbook:'seo-visibility',check:'claims-corroborated',outcome:'not-run',detail:'This stage is not an article.'}];
 const words=articleWords(input),hash=createHash('sha256').update(words).digest('hex'),lint=lintArticle({text:words,local:null});
 const noNumbers=!/\d/.test(words.replace(/\[claim:[^\]]+\]/g,''));
 const verified=input.toolCalls?.some(call=>{if(call.tool!=='seo.corroborate'||!call.envelope.ok)return false;const result=call.envelope.result as any;return result?.data?.artifactDigest===hash&&result?.data?.pass===true;});
 return [{playbook:'seo-visibility',check:'claims-corroborated',outcome:lint.pass&&(noNumbers||verified)?'pass':'fail',detail:lint.pass&&(noNumbers||verified)?'The exact article has the required source evidence.':'Check this exact article: each number needs its marker and two independent sources; rewrite blocked stock phrases.'}];
};
/** Local evidence is checked against this exact article, not a prior file or another order. */
export const seoLocalChecks:KitCheck=input=>{
 if(!isArticle(input)||input.offerKey!=='local-seo')return [{playbook:'seo-visibility',check:'local-not-doorway',outcome:'not-run',detail:'This is not a local landing page.'}];
 const hash=createHash('sha256').update(articleWords(input)).digest('hex');const good=input.toolCalls?.some(call=>{if(call.tool!=='seo.lint'||!call.envelope.ok)return false;const data=(call.envelope.result as any)?.data;return data?.artifactDigest===hash&&data?.checks?.some((c:any)=>c.id==='doorway-page'&&c.pass===true);});
 return [{playbook:'seo-visibility',check:'local-not-doorway',outcome:good?'pass':'fail',detail:good?'The local page includes all four recorded evidence elements.':'Check the exact local page and include all four local elements.'}];
};
/** Report prose cannot turn unreceipted measured figures into evidence. */
export const seoReceiptChecks:KitCheck=input=>{
 if(isArticle(input))return [{playbook:'seo-visibility',check:'report-cites-receipts',outcome:'not-run',detail:'This stage is an article, not a measurement report.'}];
 const prose=articleWords(input),numeric=/\d/.test(prose),figures=input.deliverable.sections.flatMap(s=>s.parts).filter(p=>p.kind==='figure');
 const pass=!numeric&&(!figures.length||input.receipts.length>0);
 return [{playbook:'seo-visibility',check:'report-cites-receipts',outcome:pass?'pass':'fail',detail:pass?'Measured figures use receipt-backed figure blocks.':'Put measured figures in receipt-backed figure blocks, not prose.'}];
};
