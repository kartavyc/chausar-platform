// Final SEO article checker. loamwright Apache-2.0 ideas; code reads sources after the web-free Writer finishes.
import type {FlagshipCheckInput} from '../draft-checks.ts';
import type {PlaybookCheckResult} from '../../contracts.ts';
import type {PoliteNet} from '../../build/fetch-policy.ts';
import {readSeoManifest} from './manifest-core.ts';
import {corroborateClaims} from './corroborate.ts';
import {lintArticle,stripCompetitors} from './lint.ts';
import type {ClaimInput,LocalElements} from './content-core.ts';
/** The order's manifest supplies source URLs and local facts; only the actual final text is checked. */
export async function verifySeoArticle(input:FlagshipCheckInput,net:PoliteNet={}):Promise<PlaybookCheckResult[]> {
 if(!['content-retainer','local-seo'].includes(input.offerKey??'')||(input.stageId??'write')!=='write')return [];
 const text=input.deliverable.sections.flatMap(s=>s.parts.flatMap(p=>p.kind==='text'?[p.text]:[])).join('\n');const localRequired=input.offerKey==='local-seo';
 let claimsGood=false,localGood=!localRequired,detail='Add the order evidence manifest and check this exact article.';
 try{
  const manifests=input.files.filter(f=>f.name==='seo-evidence.csv');if(manifests.length!==1)throw new Error('Upload one seo-evidence.csv containing the claim sources and local evidence.');
  const bytes=Buffer.from(manifests[0]!.contentBase64,'base64');if(bytes.length>1000000)throw new Error('Use an evidence manifest below one megabyte.');
  const evidence=readSeoManifest(bytes.toString('utf8')) as {claims:ClaimInput[];competitors:string[];local:LocalElements|null};
  const intake=input.intake?.fields?.competitors;const competitors=[...evidence.competitors,...(Array.isArray(intake)?intake.filter((v):v is string=>typeof v==='string'):[])];
  const lint=lintArticle({text,local:localRequired?evidence.local:null});localGood=!localRequired||!!lint.checks.find(c=>c.id==='doorway-page'&&c.pass);
  const noNumbers=!/\d/.test(text.replace(/\[claim:[^\]]+\]/g,''));const corroborated=noNumbers?true:(await corroborateClaims({text,claims:evidence.claims,competitors},net)).pass;
  claimsGood=input.servedBy==='model'&&lint.pass&&corroborated&&stripCompetitors(text,competitors)===text;
  detail=claimsGood?'The final article passed its source, marker, competitor and stock-phrase checks.':'The final article needs independent sources, claim markers, or a rewrite before approval.';
 }catch(error){detail=error instanceof Error?error.message:'The final article could not be checked.';}
 return [{playbook:'seo-visibility',check:'claims-corroborated',outcome:claimsGood?'pass':'fail',detail},{playbook:'seo-visibility',check:'local-not-doorway',outcome:localRequired?(localGood?'pass':'fail'):'not-run',detail:localRequired?(localGood?'All four local elements occur in the final page.':'The final local page needs all four recorded local elements.'):'This is not a local landing page.'}];
}
