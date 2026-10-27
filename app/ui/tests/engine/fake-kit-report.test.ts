import { describe, expect, it } from 'vitest';
import { FakeKitReportDesk } from '../../src/engine/fake-kit-report';
import type { W4DeskHost } from '../../src/engine/fake-w4';
import type { CaView, DeliveryLite, ReportListView, ReportShareView, ReportView } from '../../src/engine/types';

// The fake's client reports (5A5) refuse as the engine does (platform/runtime/venture/playbooks/kit/report/*.ts):
// REPORT_BLOCK_UNSOURCED for a figure with no receipt, DELIVERY_NOT_READY for a draft the owner could not accept now,
// CA_SIGNOFF_REQUIRED for a CA firm's unsigned papers, REPORT_STALE once the draft changed, and rotate checks again.
// Its sample report has real channels and dates, so the share form's channel picker runs.

const ACCEPTED: DeliveryLite = { id: 'd-ep12-script', at: '2026-10-03T10:00:00.000Z', orderId: 'o-boat-12', status: 'accepted', practice: false, deliverable: { title: 'Sponsor script for episode 12' }, verdict: { choice: 'accepted', at: '2026-10-03T12:00:00.000Z' }, renderedText: 'Steady growth.' };

function desk(drafts: DeliveryLite[], ca: CaView | null = null, hosted = false) {
  let n = 0;
  const host: W4DeskHost = {
    current: () => 'lumen', now: () => '2026-10-27T10:00:00.000Z', emit: () => {}, hosted: () => hosted, rows: () => [], setRows: () => {},
    digest: (value) => `digest-${JSON.stringify(value).length}-${++n}`,
    ask: (method) => (method === 'venture.delivery.list' ? drafts : method === 'venture.ca.get' ? (ca ?? { ca: null, pendingRates: [], requests: [] }) : null),
  };
  return new FakeKitReportDesk(host);
}
const code = (fn: () => unknown) => { try { fn(); } catch (error) { return (error as { code?: string }).code; } return 'none'; };

describe('fake client reports', () => {
  it('the sample report has its figures, channels and dates; venture.report.list keeps it, without bytes', () => {
    const d = desk([ACCEPTED]);
    const view = d.request('venture.report.render', { runId: 'd-ep12-script', formats: ['html', 'xlsx'] }) as ReportView;
    expect(view.channels).toEqual(['instagram', 'linkedin']);
    expect(view.period).toEqual({ from: '2026-08-01', to: '2026-09-30' });
    expect(atob(view.files[0]!.contentBase64)).toContain('12,400');
    const listed = d.request('venture.report.list', { orderId: 'o-boat-12' }) as ReportListView;
    expect(listed.reports.map((report) => report.id)).toEqual([view.id]);
    expect(JSON.stringify(listed)).not.toContain('contentBase64');
    expect(code(() => d.request('venture.report.list', { orderId: 'o-boat-12', runId: 'd-ep12-script' }))).toBe('INVALID_VENTURE_REQUEST');
  });

  it('refuses a figure with no receipt, a draft not ready to accept, unsigned CA papers and a changed draft; rotate checks again', () => {
    expect(code(() => desk([{ ...ACCEPTED, id: 'd-ep14-script', status: 'ready-for-review', verdict: null }]).request('venture.report.render', { runId: 'd-ep14-script' }))).toBe('REPORT_BLOCK_UNSOURCED');

    const blocked = desk([{ ...ACCEPTED, status: 'ready-for-review', verdict: null, canAccept: false, acceptBlocked: 'A check failed.' }]);
    const early = blocked.request('venture.report.render', { runId: 'd-ep12-script', formats: ['html'] }) as ReportView;
    expect(code(() => blocked.request('venture.report.share', { reportId: early.id, from: '2026-08-01', to: '2026-09-30' }))).toBe('DELIVERY_NOT_READY');

    const papers: CaView = { ca: { name: 'CA Mehta', membershipNo: '123456' } as CaView['ca'], pendingRates: [], requests: [{ id: 'sr1', deliveryId: 'd-ep12-script', title: 'ITR', state: 'sent', at: '2026-10-20T10:00:00.000Z' }] };
    const unsigned = desk([ACCEPTED], papers);
    const caReport = unsigned.request('venture.report.render', { runId: 'd-ep12-script', formats: ['html'] }) as ReportView;
    expect(code(() => unsigned.request('venture.report.share', { reportId: caReport.id, from: '2026-08-01', to: '2026-09-30' }))).toBe('CA_SIGNOFF_REQUIRED');

    const drafts = [{ ...ACCEPTED }];
    const changing = desk(drafts, null, true);
    const report = changing.request('venture.report.render', { runId: 'd-ep12-script', formats: ['html'] }) as ReportView;
    const link = changing.request('venture.report.share', { reportId: report.id, from: '2026-08-01', to: '2026-09-30', channels: ['instagram'] }) as ReportShareView;
    expect(link.url).toMatch(/^https:\/\/chausar\.test\/share\/[A-Za-z0-9_-]{32}$/);
    expect(code(() => changing.request('venture.report.share', { reportId: report.id, from: '2026-08-01', to: '2026-09-30', channels: ['tiktok'] }))).toBe('INVALID_VENTURE_REQUEST');
    drafts[0] = { ...ACCEPTED, status: 'edited', editedText: 'New words.' };
    expect(code(() => changing.request('venture.report.share', { reportId: report.id, from: '2026-08-01', to: '2026-09-30' }))).toBe('REPORT_STALE');
    expect(code(() => changing.request('venture.report.shareRotate', { shareId: link.id }))).toBe('REPORT_STALE');
    expect((changing.request('venture.report.shareDisable', { shareId: link.id }) as ReportShareView).state).toBe('disabled');
  });
});
