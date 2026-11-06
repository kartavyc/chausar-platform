import type { PanelSpec, SeoObservationBody, SeoPanelBody, WebsiteCheckData } from '../../../../contract/venture/playbooks/seo-visibility/records.ts';
export type { PanelSpec, SeoObservationBody, SeoPanelBody, WebsiteCheckData } from '../../../../contract/venture/playbooks/seo-visibility/records.ts';
// Chausar SEO panel records. GEOHub (AGPL, ideas only); independent schema, no copied source.



/** Findings remain a separate type for the refresh package; they never imply applied fixes. */
export type SeoFindingBody = {
    publication?: SeoPublication;
    edge?: SeoEdgeBinding;
    strategy?: SeoStrategy;
    work?: import('./work-core.ts').SeoWorkBody;
    sourceUrl: string;
    ruleId: string;
    evidenceDigest: string;
    state: 'open' | 'muted' | 'resolved';
    monitor?: import('./monitor-core.ts').SeoMonitorBody;
    website?: WebsiteCheckData;
    recheck?: WebsiteRecheck | null;
};
export type SeoPublication={runId:string;orderId:string;draftDigest:string;connectionDigest:string;outcome:'applied'|'not-sent'|'unknown';postId:number|null;link:string|null;at:string;acceptance:{url:string;checkedOn:string;receipt:string;articleDigest:string;pass:boolean}|null};
export type SeoEdgeBinding={editId:string;runId:string;orderId:string;draftDigest:string;connectionDigest:string};
export type SeoStrategy={workId:string;panelId:string;orderId:string;candidateDigest:string;fidelityDigest:string;experimentDigest:string;panelDigest:string;publicationId:string|null;publicationDigest:string|null;receiptDigest:string|null;state:'candidate'|'held'|'remembered'|'stopped';measurementReceipt:string|null;checkedAt:string|null;line:string};
/** A website report stored without the original large JSON bundle. */

export type SeoWebsiteItem = {
    id: string;
    report: WebsiteCheckData;
    recheck: WebsiteRecheck | null;
};

/** Exact owner-approved thirty-day checks; every collected report stays unapproved. */
export type WebsiteRecheck = { claimId: string | null; state: 'active' | 'collecting' | 'held' | 'stopped'; nextAt: string | null; lastAt: string | null; latestReceipt: string; latestReportId: string; error: string | null };
