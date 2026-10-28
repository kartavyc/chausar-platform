// Chausar SEO panel records. GEOHub (AGPL, ideas only); independent schema, no copied source.
export type PanelSpec = {
    questions: {
        id: string;
        text: string;
    }[];
    engines: string[];
    timepoints: {
        id: string;
        from: string;
        to: string;
    }[];
    repeats: number;
    minimumFilled: number;
};
export type SeoPanelBody = {
    spec: PanelSpec;
    state: 'draft' | 'approved';
    approvedDigest: string | null;
    orderId: string | null;
};
export type SeoObservationBody = {
    panelId: string;
    panelDigest: string;
    questionId: string;
    engine: string;
    timepointId: string;
    repeat: number;
    capturedAt: string;
    method: 'owner-capture' | 'api';
    screenshotFileId: string | null;
    answer: string;
    mentioned: boolean;
    fixture: boolean;
    slot: string;
};
/** Findings remain a separate type for the refresh package; they never imply applied fixes. */
export type SeoFindingBody = {
    sourceUrl: string;
    ruleId: string;
    evidenceDigest: string;
    state: 'open' | 'muted' | 'resolved';
    monitor?: import('./monitor-core.ts').SeoMonitorBody;
    website?: WebsiteCheckData;
    recheck?: WebsiteRecheck | null;
};
/** A website report stored without the original large JSON bundle. */
export type WebsiteCheckData = {
    url: string;
    receipt: string;
    findings: {
        what: string;
        selector: string;
        measured: string;
        expected: string;
        fix: string;
        repeats: number;
        unresolved: boolean;
    }[];
    approved: boolean;
    previousReceipt: string | null;
    checkedFrames: number;
    limits: string;
};
export type SeoWebsiteItem = {
    id: string;
    report: WebsiteCheckData;
    recheck: WebsiteRecheck | null;
};

/** Exact owner-approved thirty-day checks; every collected report stays unapproved. */
export type WebsiteRecheck = { claimId: string | null; state: 'active' | 'collecting' | 'held' | 'stopped'; nextAt: string | null; lastAt: string | null; latestReceipt: string; latestReportId: string; error: string | null };
