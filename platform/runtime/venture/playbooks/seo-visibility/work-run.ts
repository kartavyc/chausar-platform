// SEO monthly work executes checks over actual order source bytes. Independent Chausar integration.
import type {PoliteNet} from '../../build/fetch-policy.ts';
import {readSeoManifest,readRefreshSource} from './manifest-core.ts';
import {seoNeed} from './content-core.ts';
import type {SeoWorkOperation} from './work-core.ts';
/** No operation here sends, publishes or changes a live post. */
export async function runSeoWork(operation:SeoWorkOperation,text:string,net:PoliteNet={}){
 seoNeed(text.length<=1000000,'SEO_INPUT_INVALID','Use an evidence file below one megabyte.');
 if(operation==='refresh'){const {refreshPlan}=await import('./refresh.ts');return refreshPlan(readRefreshSource(text));}
 const input=readSeoManifest(text);
 if(operation==='content'){const {lintArticle,stripCompetitors}=await import('./lint.ts');const {corroborateClaims}=await import('./corroborate.ts');const {validateClaims}=await import('./content-core.ts');validateClaims(input);const cleaned=stripCompetitors(input.text,input.competitors),lint=lintArticle({text:cleaned,local:input.local??null});const corroboration=input.claims.length?await corroborateClaims({...input,text:cleaned},net):{pass:!/[0-9]/.test(cleaned),claims:[],sourceGaps:[]};return {pass:lint.pass&&corroboration.pass,text:cleaned,lint,corroboration};}
 if(operation==='meta'){const {checkMeta}=await import('./meta.ts');return checkMeta(input);}
 if(operation==='impact'){const {measureImpact}=await import('./impact.ts');return measureImpact(input);}
 if(operation==='local'){const {auditLocal,localTemplates}=await import('./local.ts');return {...await auditLocal(input,net),templates:localTemplates(input.industry??'local business')};}
 // Strategy input is assembled from bound vault records by the desk; uploaded digest claims never establish memory.
 throw Object.assign(new Error('Build a strategy from its recorded work, panel and publication receipt.'),{code:'STRATEGY_BINDING_REQUIRED'});
}
