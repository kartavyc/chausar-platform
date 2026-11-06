// Read-only developer evidence tools. Effects remain separately owner-approved in the native desk.
import type { ToolName } from '../../contracts.ts';
import {check} from '../../../contracts.ts';import {findRecord} from '../../records.ts';import type {Spec,ToolEnv} from './tools.ts';import {devRunSource} from '../../playbooks/dev-agency/run-source.ts';import {devDelivery} from '../../playbooks/dev-agency/report.ts';
function scoped(env:ToolEnv){const run=env.runRef.kind==='delivery'?findRecord(env.deps.store.read(),'venture-delivery-run',env.runRef.runId):null;check(run&&run.ventureId===env.ventureId,'DEV_PROJECT_NOT_FOUND','Use the current client order developer run.');return devRunSource(env.deps,env.ventureId,run.orderId);}

type DevAgencyToolName = Extract<ToolName, 'qa.verdict' | 'security.scan'>;

export const DEV_AGENCY_TOOLS: Readonly<Record<DevAgencyToolName, Spec>> = Object.freeze({
 'qa.verdict':{name:'qa.verdict',effect:'compute',tier:'code',endsTurn:false,summary:'Read the current source-bound review and its code verdict. Never grants production safety or push approval.',input:{},async run(env){const {report}=scoped(env);return {result:{report,delivery:devDelivery(report),saved:false}};}},
 'security.scan':{name:'security.scan',effect:'read',tier:'code',endsTurn:false,summary:'Read current saved dependency audit and source findings. Does not run a scanner, test a live system or certify security.',input:{},async run(env){const {project,report}=scoped(env);return {result:{sourceDigest:project.sourceDigest,findings:report.findings,audit:project.audit,securityCertified:false,scannedLive:false,saved:false}};}}
});
