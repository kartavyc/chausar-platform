import { check, type State } from '../../contracts.ts';
import type { DeliveryRunRecord, OrderRecord, VentureRecordKind } from '../contracts.ts';
import { digest, listRecords } from '../records.ts';
import { refuseRecruitDraft } from '../playbooks/recruiting-desk/run-guard.ts';
import { recruitingReport } from '../playbooks/recruiting-desk/report.ts';
import { narrationReportRows, narrationReportReady } from '../playbooks/narration-studio/checks.ts';
import { tenderApproved } from '../playbooks/tender-desk/state.ts';
import { briefApproved } from '../playbooks/document-desk/core.ts';
import {socialReportSources} from '../playbooks/social/report-run.ts';
import { formsRunSource } from '../playbooks/data-entry-desk/run-source.ts';
import { sellerReportSource } from '../playbooks/online-seller/report-source.ts';
import { lessonDeskContext } from '../playbooks/lesson-desk/context.ts';

/** Project only this client's current order. Secret-bearing transport state and unrelated captured people stay private. */
export function deskContext(state: State, run: DeliveryRunRecord, order: OrderRecord, flagship: string | undefined, offerKey:string|null=null) {
  const scoped = <K extends VentureRecordKind>(kind: K) => listRecords(state, kind, run.ventureId)
    .filter((row: any) => row.orderId === order.id && row.clientId === order.clientId);
  // W6 6E2 (D21): a child's lesson records reach the AI only with their parent's current consent; refused here otherwise.
  if (flagship === 'lesson-desk') return lessonDeskContext(state, run, order);
  if (flagship === 'online-seller') {
    const files=listRecords(state,'venture-upload',run.ventureId).filter(file=>file.scope.kind==='order'&&file.scope.orderId===order.id&&(run.uploadIds===undefined||run.uploadIds.includes(file.id)));
    const report=sellerReportSource(order,offerKey,files,run.at.slice(0,10));
    return {binding:digest({files,report}),data:{sellerReport:report}};
  }
  if (flagship === 'social-agency' && order.socialChain?.offerKey === 'monthly-report') {
    const files=listRecords(state,'venture-upload',run.ventureId).filter(file=>file.scope.kind==='order'&&file.scope.orderId===order.id&&(run.uploadIds===undefined||run.uploadIds.includes(file.id)));
    const report=socialReportSources(order,files);
    return {binding:digest({files,report}),data:{reportSources:report}};
  }
  if (flagship === 'recruiting-desk') {
    const venture = listRecords(state, 'venture-record').find(row => row.id === run.ventureId)!;
    refuseRecruitDraft(state, venture, order);
    const role = listRecords(state, 'venture-recruit-role', run.ventureId).find(row => row.serviceOrderId === order.id && row.clientId === order.clientId)!;
    const candidates = listRecords(state, 'venture-recruit-candidate', run.ventureId).filter(row => row.roleId === role.id);
    const touches = listRecords(state, 'venture-recruit-touch', run.ventureId).filter(row => row.roleId === role.id);
    const interviews = listRecords(state, 'venture-recruit-interview', run.ventureId).filter(row => row.roleId === role.id);
    return { binding: digest({ role, candidates, touches, interviews }), data: {
      recruitingRole: role.brief, recruitingReport: recruitingReport(role, candidates, touches, run.at.slice(0, 10)),
    } };
  }
  if (flagship === 'data-entry-desk') {
    const source = formsRunSource(state, run.ventureId, order.id);
    return { binding: digest(source), data: { formsEntries: source.rows } };
  }
  if (flagship === 'tender-desk') {
    const rows = scoped('venture-tender-question');
    check(rows.length && rows.every(tenderApproved), 'TENDER_APPROVAL_REQUIRED', 'Approve the current tender answers before starting AI work.');
    return { binding: digest(rows), data: { tenderRows: rows.map(({ id, sourceDigest, question, controls, approval }) => ({ id, sourceDigest, question, controls, approval })) } };
  }
  if (flagship === 'document-desk') {
    // W6 6E4: AI work starts only from the owner's approved brief; the draft gets the outline, never the figures to copy.
    const row = scoped('venture-document').at(-1);
    check(row && briefApproved(row), 'DOCUMENT_BRIEF_REQUIRED', 'Approve the document outline, files and figures in the document desk before starting AI work.');
    return { binding: digest({ id: row.id, brief: row.briefApproval }), data: { documentBrief: { docType: row.docType, title: row.title, sourceFileIds: row.sourceFileIds,
      outline: row.sections.map(({ heading, brief }) => ({ heading, brief })), figures: row.figures ? 'The figures table joins the export with its receipt. Write no amounts.' : null } } };
  }
  if (flagship === 'narration-studio') {
    const rows = scoped('venture-narration-segment').sort((a, b) => a.sequence - b.sequence), report = narrationReportRows(rows);
    check(narrationReportReady(report), 'NARRATION_APPROVAL_REQUIRED', 'Master and approve the current audio before starting AI work.');
    return { binding: digest(rows), data: { narrationRows: report } };
  }
  if (flagship === 'website-studio') {
    const rows = scoped('venture-site-requirement'), row = rows.at(-1);
    const project = row ? { brief: row.brief, pages: row.pages, forms: row.forms, domain: row.domain,
      requirements: row.requirements, source: row.source, uiReport: row.uiReport, briefApproved: row.briefApproved } : null;
    return { binding: digest(rows), data: { siteProject: project } };
  }
  if (flagship === 'newsletter-studio') {
    const rows = scoped('venture-newsletter-issue'), row = rows.at(-1);
    const issue = row ? { purpose: row.purpose, sourceNotes: row.sourceNotes, language: row.language, aiEvidence: row.aiEvidence, draft: row.draft, state: row.state } : null;
    return { binding: digest(rows), data: { newsletterIssue: issue } };
  }
  if (flagship === 'podcast-to-article') {
    const rows = scoped('venture-article-ledger');
    return { binding: digest(rows), data: { articleRecord: rows.at(-1) ?? null } };
  }
  return { binding: null, data: {} };
}
