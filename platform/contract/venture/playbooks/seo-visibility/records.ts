// Canonical browser-safe types, shared by the engine and renderer.


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

export type SeoPanelBody = {
    spec: PanelSpec;
    state: 'draft' | 'approved';
    approvedDigest: string | null;
    orderId: string | null;
};

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
