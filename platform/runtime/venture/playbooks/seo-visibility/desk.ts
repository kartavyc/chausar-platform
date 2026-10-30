// Chausar SEO desk: persisted panels and captured answers. GEOHub (AGPL ideas only); no source copied.
import { check, type State } from '../../../contracts.ts';
import type { SeoObservationRecord, SeoPanelRecord, VentureRecord } from '../../contracts.ts';
import { digest, exactPayload, listRecords, readVenture, requireAppChannel, ventureAction } from '../../records.ts';
import type { DeskHandlers } from '../desk-types.ts';
import { makePanel, editPanel, approvePanel, observePanel, panelMetrics } from './panel.ts';
import type { SeoPanelBody, SeoObservationBody, SeoWebsiteItem } from './records.ts';
import { SEO_WORK_DESK, type SeoWorkDeskTypes } from './work-desk.ts';
import { SEO_PUBLISHING_DESK, type SeoPublishingDeskTypes } from './publishing-desk.ts';
import { SEO_STRATEGY_DESK, type SeoStrategyDeskTypes } from './strategy-desk.ts';
import { SEO_EDGE_DESK, type SeoEdgeDeskTypes } from './edge-desk.ts';
import { SEO_WEBSITE_DESK } from './site-desk.ts';
import { SEO_MONITOR_DESK } from './monitor-desk.ts';
import type { SeoMonitorItem } from './monitor-core.ts';
export type SeoPanelRow = {
    id: string;
    state: 'draft' | 'approved';
    questionCount: number;
    slots: number;
    filled: number;
    missing: number;
    live: boolean;
};
export type SeoPanelItem = {
    id: string;
    panel: SeoPanelBody;
    metrics: ReturnType<typeof panelMetrics>;
    observations: SeoObservationBody[];
};
export type SeoVisibilityDeskTypes = SeoWorkDeskTypes & SeoPublishingDeskTypes & SeoEdgeDeskTypes & SeoStrategyDeskTypes & {
    monitor: { filter: null; row: SeoMonitorItem; item: SeoMonitorItem; actions: Record<string,{payload:any;result:SeoMonitorItem}> };
    website: {
        filter: null;
        row: SeoWebsiteItem;
        item: SeoWebsiteItem;
        actions: Record<string, {
            payload: any;
            result: SeoWebsiteItem;
        }>;
    };
    panel: {
        filter: null;
        row: SeoPanelRow;
        item: SeoPanelItem;
        actions: Record<string, {
            payload: any;
            result: SeoPanelItem;
        }>;
    };
};
const body = (record: SeoPanelRecord): SeoPanelBody => ({ spec: structuredClone(record.spec), state: record.state, approvedDigest: record.approvedDigest, orderId: record.orderId });
/** The viewed digest covers the panel and current answers, so approval never overlooks an intervening change. */
export function seoPanelItem(state: State, venture: VentureRecord, record: SeoPanelRecord): SeoPanelItem {
    const observations = listRecords(state, 'venture-seo-observation', venture.id).filter(item => item.panelId === record.id).map(({ panelId, panelDigest, questionId, engine, timepointId, repeat, capturedAt, method, screenshotFileId, answer, mentioned, fixture, slot }) => ({ panelId, panelDigest, questionId, engine, timepointId, repeat, capturedAt, method, screenshotFileId, answer, mentioned, fixture, slot }));
    const panel = body(record);
    const metrics = panel.state === 'approved' ? panelMetrics(panel, observations) : { mentions: { numerator: 0, denominator: panel.spec.questions.length * panel.spec.engines.length * panel.spec.timepoints.length * panel.spec.repeats, missing: panel.spec.questions.length * panel.spec.engines.length * panel.spec.timepoints.length * panel.spec.repeats }, filled: 0, minimumFilled: panel.spec.minimumFilled, status: 'not-enough-data', live: true, fixtures: 0, line: 'Approve this panel before collecting answers.' };
    return { id: record.id, panel, metrics, observations };
}
const panelIn = (state: State, venture: VentureRecord, id: string) => { const record = listRecords(state, 'venture-seo-panel', venture.id).find(record => record.id === id); check(record, 'PANEL_NOT_FOUND', 'That answer panel was not found.'); return record; };
export const SEO_VISIBILITY_DESK: DeskHandlers = Object.freeze({ ...SEO_EDGE_DESK, ...SEO_STRATEGY_DESK, ...SEO_PUBLISHING_DESK, ...SEO_WORK_DESK, ...SEO_WEBSITE_DESK, ...SEO_MONITOR_DESK, panel: {
        async list(deps, ctx, payload) {
            const p = exactPayload(payload, ['playbook', 'kind', 'filter'], ['playbook', 'kind']);
            check(p.filter === undefined || p.filter === null, 'INVALID_VENTURE_REQUEST', 'This panel list has no filters.');
            const { state, venture } = readVenture(deps, ctx);
            const rows: SeoPanelRow[] = listRecords(state, 'venture-seo-panel', venture.id).map(record => { const item = seoPanelItem(state, venture, record); return { id: record.id, state: record.state, questionCount: record.spec.questions.length, slots: item.metrics.mentions.denominator, filled: item.metrics.filled, missing: item.metrics.mentions.missing, live: item.metrics.live }; });
            return { playbook: 'seo-visibility', kind: 'panel', rows, line: rows.length ? 'Answer panels, with missing slots kept in.' : 'No answer panel yet.' };
        },
        async get(deps, ctx, payload) { exactPayload(payload, ['playbook', 'kind', 'id'], ['playbook', 'kind', 'id']); const { state, venture } = readVenture(deps, ctx); const item = seoPanelItem(state, venture, panelIn(state, venture, payload.id)); return { playbook: 'seo-visibility', kind: 'panel', item, digest: digest(item) }; },
        async act(deps, ctx, payload) {
            requireAppChannel(ctx, 'venture.desk.act');
            const p = exactPayload(payload, ['playbook', 'kind', 'id', 'action', 'payload', 'digest'], ['playbook', 'kind', 'id', 'action', 'payload']);
            check(typeof p.id === 'string' && typeof p.action === 'string', 'INVALID_VENTURE_REQUEST', 'Choose a panel and an action.');
            return ventureAction(deps, ctx, 'approve', 'seo.panel.' + payload.action, tx => {
                const venture = tx.venture!;
                let record: SeoPanelRecord;
                if (payload.action === 'create') {
                    check(payload.id === 'new' && p.digest === undefined, 'INVALID_VENTURE_REQUEST', 'A new panel has no prior digest.');
                    const input = exactPayload(payload.payload, ['spec', 'orderId'], ['spec', 'orderId']);
                    check(input.orderId === null || typeof input.orderId === 'string', 'INVALID_VENTURE_REQUEST', 'Choose an order or no order.');
                    if (input.orderId !== null)
                        check(tx.find('venture-order', input.orderId as string), 'ORDER_NOT_FOUND', 'That order was not found.');
                    record = tx.put<SeoPanelRecord>({ ...tx.base('venture-seo-panel'), ...makePanel(input.spec), orderId: input.orderId as string | null });
                }
                else {
                    record = panelIn(tx.state, venture, payload.id);
                    const seen = seoPanelItem(tx.state, venture, record);
                    check(typeof payload.digest === 'string' && payload.digest === digest(seen), 'PANEL_STALE', 'This answer panel changed. Open it again.');
                    if (payload.action === 'approve') {
                        exactPayload(payload.payload, []);
                        record = tx.replace({ ...record, ...approvePanel(body(record)) });
                    }
                    else if (payload.action === 'edit') {
                        const input = exactPayload(payload.payload, ['spec'], ['spec']);
                        record = tx.replace({ ...record, ...editPanel(body(record), input.spec) });
                    }
                    else if (payload.action === 'observe') {
                        const observation = observePanel(body(record), payload.payload);
                        check(!tx.list('venture-seo-observation').some(item => item.panelId === record.id && item.slot === observation.slot), 'PANEL_SLOT_FILLED', 'That panel slot already has an answer.');
                        if (observation.method === 'owner-capture') {
                            const file = tx.find('venture-upload', observation.screenshotFileId!);
                            check(file && file.format === 'image', 'PANEL_SCREENSHOT_REQUIRED', 'Upload the capture screenshot before recording the answer.');
                            if (record.orderId)
                                check((file.scope.kind === 'order' || file.scope.kind === 'media') && file.scope.orderId === record.orderId, 'PANEL_SCREENSHOT_REQUIRED', 'Choose a screenshot from this panel order.');
                        }
                        check(observation.method !== 'api' || observation.fixture, 'PANEL_API_PLANNED', 'Live API collection is planned. Capture the answer with a screenshot instead.');
                        tx.put<SeoObservationRecord>({ ...tx.base('venture-seo-observation'), ...observation, panelId: record.id });
                    }
                    else
                        check(false, 'INVALID_VENTURE_REQUEST', 'This panel action is not available.');
                }
                const result = seoPanelItem(tx.state, venture, record);
                tx.emit('desk.changed', { playbook: 'seo-visibility', id: record.id });
                return { playbook: 'seo-visibility' as const, kind: 'panel', id: record.id, result, line: payload.action === 'approve' ? 'Panel approved and frozen.' : 'Answer panel saved.' };
            });
        },
    } });
