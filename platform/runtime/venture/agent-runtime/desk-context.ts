import { check, type State } from '../../contracts.ts';
import type { DeliveryRunRecord, OrderRecord, VentureRecordKind } from '../contracts.ts';
import { digest, listRecords } from '../records.ts';
import { refuseRecruitDraft } from '../playbooks/recruiting-desk/run-guard.ts';
import { recruitingReport } from '../playbooks/recruiting-desk/report.ts';
import { narrationReportRows, narrationReportReady } from '../playbooks/narration-studio/checks.ts';
import { tenderApproved } from '../playbooks/tender-desk/state.ts';
import {socialReportSources} from '../playbooks/social/report-run.ts';
import { formsRunSource } from '../playbooks/data-entry-desk/run-source.ts';

/** Project only this client's current order. Secret-bearing transport state and unrelated captured people stay private. */
export function deskContext(state: State, run: DeliveryRunRecord, order: OrderRecord, flagship: string | undefined) {
  const scoped = <K extends VentureRecordKind>(kind: K) => listRecords(state, kind, run.ventureId)
    .filter((row: any) => row.orderId === order.id && row.clientId === order.clientId);
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
