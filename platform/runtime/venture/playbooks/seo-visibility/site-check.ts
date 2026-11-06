// Chausar website checks. lintapple (MIT), public API verified from upstream README/types on 27 October 2026.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { ChausarError } from '../../../contracts.ts';
import { digest } from '../../records.ts';
import { checkFetchPolicy, robotsCheck, politeFetch, robotsSafe, CHAUSAR_USER_AGENT, type PoliteNet } from '../../build/fetch-policy.ts';
import { pinnedSend } from '../../core/net-guard.ts';
import { parseWebsiteReport } from './site-report-core.ts';
export type SiteCheckerPort = {
    run(url: string, signal?: AbortSignal): Promise<unknown>;
};
export type WebsiteFinding = {
    what: string;
    selector: string;
    measured: string;
    expected: string;
    fix: string;
    repeats: number;
    unresolved: boolean;
};
export type WebsiteCheck = {
    url: string;
    receipt: string;
    findings: WebsiteFinding[];
    approved: boolean;
    previousReceipt: string | null;
    checkedFrames: number;
    limits: string;
};
/** An owner-installed lintapple is used as a library; Chausar never installs or downloads it. */
export function installedWebsiteChecker(net:PoliteNet={}):SiteCheckerPort|null {
 let entry:string;
 try{entry=createRequire(import.meta.url).resolve('lintapple');}catch{return null;}
 return {async run(url,signal){
  const checker=await import(pathToFileURL(entry).href);
  const playwrightPath=createRequire(entry).resolve('playwright');
  const {chromium}=await import(pathToFileURL(playwrightPath).href);
  const browser=await chromium.launch({headless:true});
  const cancel=()=>{void browser.close().catch(()=>undefined);};signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted){await browser.close();throw new ChausarError('SITE_CHECK_INTERRUPTED','This re-check was stopped.');}
  const runs:Record<string,unknown>[]=[],findings:Record<string,unknown>[]=[];
  try{
   for(const viewport of [{width:390,height:844},{width:1280,height:900}])for(const colorScheme of ['light','dark']){
    const context=await browser.newContext({viewport,colorScheme,userAgent:CHAUSAR_USER_AGENT,serviceWorkers:'block',reducedMotion:'reduce',locale:'en-IN',timezoneId:'Asia/Kolkata'});
    try{
     await context.routeWebSocket('**/*',(socket:any)=>socket.close());
     let blocked=false;
     await context.route('**/*',async(route:any)=>{
      try{const request=route.request();const response=await websiteBrowserRead(request.url(),request.method(),net);const headers={...response.headers};delete headers['set-cookie'];delete headers['content-length'];await route.fulfill({status:response.status,headers,body:response.body});}
      catch{blocked=true;await route.abort('blockedbyclient');}
     });
     const page=await context.newPage();await page.goto(url,{waitUntil:'networkidle',timeout:20000});await page.evaluate('document.fonts.ready');const report=await checker.checkPage(page);
     if(blocked)throw new ChausarError('SITE_CHECK_INCOMPLETE','A browser request was refused by the network or robots guard. Review the source gap.');
     runs.push({...report,viewport,colorScheme});for(const finding of report.findings)findings.push({...finding,viewport,colorScheme});
    }finally{await context.close();}
   }
   return {url,runs,findings};
  }finally{signal?.removeEventListener('abort',cancel);await browser.close();}
 }};
}
/** Every browser subrequest is a guarded read with Chausar's own identity, never a form submit or a local-network read. */
export async function websiteBrowserRead(raw:string,method:string,net:PoliteNet={}){
 if(method!=='GET'&&method!=='HEAD')throw new ChausarError('SITE_CHECK_WRITE_REFUSED','A website check never submits forms or writes to the site.');
 const url=checkFetchPolicy(raw);
 return politeFetch({url:url.href,method,maxBytes:4*1024*1024,timeoutMs:15000,maxRedirects:3},{resolve:net.resolve,send:robotsSafe(net.send??pinnedSend,net.resolve)});
}
/** Validate complete phone/desktop and light/dark coverage, retaining unresolved findings and a report hash. */
export async function websiteCheck(raw: string, port: SiteCheckerPort | null = installedWebsiteChecker(), previousReceipt: string | null = null): Promise<WebsiteCheck> {
    const url = checkFetchPolicy(raw).href;
    if (!port)
        throw new ChausarError('SITE_CHECK_PLANNED', 'Install lintapple yourself or upload its JSON report. Chausar never installs it.');
    return websiteReport(url, await port.run(url), previousReceipt);
}
/** Reports imported by the owner use the same validation as local checker output. */
export function websiteReport(url: string, raw: unknown, previousReceipt: string | null = null): WebsiteCheck {
    try {
        return parseWebsiteReport(url, raw, digest, previousReceipt);
    }
    catch (error) {
        if (error instanceof Error && 'code' in error)
            throw new ChausarError(String(error.code), error.message);
        throw error;
    }
}
/** The exact report, never a changed rerun, is what the owner approves for sharing. */
export function approveWebsiteCheck(report: WebsiteCheck, receipt: string): WebsiteCheck { if (receipt !== report.receipt)
    throw new ChausarError('SITE_CHECK_STALE', 'This report changed. Review it again.'); return { ...report, approved: true }; }
/** Recurring configuration is always an explicit owner action; this descriptor grants no unattended send. */
export function scheduleWebsiteRecheck(report: WebsiteCheck, ownerApproved: boolean) { if (!ownerApproved || !report.approved)
    throw new ChausarError('APPROVAL_REQUIRED', 'Approve the report and this monthly re-check first.'); return { kind: 'monthly-website-recheck', url: report.url, previousReceipt: report.receipt, askBeforeSharing: true }; }
/** Trusted workflow path checks robots before invoking the installed browser checker. */
export async function runPublicWebsiteCheck(raw: string, net: PoliteNet = {}, checker: SiteCheckerPort | null = installedWebsiteChecker(net), signal?: AbortSignal) {
 const url=checkFetchPolicy(raw);if(signal?.aborted)throw new ChausarError('SITE_CHECK_INTERRUPTED','This re-check was stopped.');
 if(!(await robotsCheck(url,net)).allowed)throw new ChausarError('ROBOTS_REFUSED','The site robots rules do not allow this check.');
 if(signal?.aborted)throw new ChausarError('SITE_CHECK_INTERRUPTED','This re-check was stopped.');
 return websiteCheck(url.href,checker?{run:address=>checker.run(address,signal)}:null);
}
