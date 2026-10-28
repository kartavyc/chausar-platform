// SEO fake desk. Browser-safe panel schema shared with the real engine; GEOHub (AGPL ideas only), no copied source.
import { EngineError, type UploadLite, type OrderLite } from './types';
import type { FakePlaybookDesk } from './fake-playbooks';
import type { W4DeskHost } from './fake-w4';
import { fakeSeoWorkKind } from './fake-seo-work';
import { fakeSeoPublishingKinds } from './fake-seo-publishing';
import { fakeSeoStrategyKind } from './fake-seo-strategy';
import { fakeSeoWebsiteKind } from './fake-seo-website';
import { fakeSeoMonitorKind } from './fake-seo-monitor';
import { newPanel, changedPanel, frozenPanel, checkedObservation, measuredPanel } from '../../../../platform/runtime/venture/playbooks/seo-visibility/panel-core';
import type { SeoObservationBody, SeoPanelBody } from '../../../../platform/runtime/venture/playbooks/seo-visibility/records';
export const SEO_FAKE_META = {
    registration: { id: 'seo-visibility', label: 'Search and AI-search visibility', serviceType: 'content', picks: ['seo agency', 'seo service', 'seo for', 'local seo', 'search engine optimisation', 'search engine optimization', 'google business profile', 'ai search visibility', 'generative engine optimisation', 'aeo service'], summary: 'Agents check client sites and captured AI answers; you approve each report and every change.' },
    offers: [{ id: 'visibility-check', name: 'Visibility check', description: 'An evidence report with source gaps and practical fixes.', pricing: 'project', unit: 'per site', intake: ['siteUrl', 'buyerQuestions', 'engines', 'gscExport'] }, { id: 'quarterly-remeasure', name: 'Quarterly remeasurement', description: 'An evidence report with source gaps and practical fixes.', pricing: 'project', unit: 'per site', intake: ['siteUrl', 'buyerQuestions', 'engines', 'gscExport'] }, { id: 'website-check', name: 'Website check', description: 'An evidence report with source gaps and practical fixes.', pricing: 'project', unit: 'per site', intake: ['siteUrl', 'buyerQuestions', 'engines', 'gscExport'] },{id:'content-retainer',name:'Content retainer',description:'An evidence report with source gaps and practical fixes.',pricing:'monthly',unit:'per article',intake:['siteUrl','competitors','articleLimitUsd']},{id:'fix-and-measure',name:'Fix and measure',description:'An evidence report with source gaps and practical fixes.',pricing:'monthly',unit:'per site',intake:['siteUrl','buyerQuestions','engines','gscExport']},{id:'local-seo',name:'Local search care',description:'An evidence report with source gaps and practical fixes.',pricing:'monthly',unit:'per site',intake:['siteUrl','city','serviceArea','articleLimitUsd']}],
    intakeFields: [{id:'articleLimitUsd',label:'Article AI limit in US dollars',help:'The most AI may cost for this article, beside your monthly limit.',kind:'text',required:false},{ id: 'siteUrl', label: 'Client site URL', help: 'The public site the client asked you to check.', kind: 'text', required: true }, { id: 'buyerQuestions', label: 'Buyer questions', help: 'Questions real buyers ask about this business.', kind: 'list', required: false }, { id: 'engines', label: 'Answer engines', help: 'The engines the owner will capture.', kind: 'list', required: false }, { id: 'gscExport', label: 'Search Console CSV', help: 'An optional export from the client account.', kind: 'file', required: false }, { id: 'competitors', label: 'Competitor sites', help: 'Public competitor addresses supplied by the client.', kind: 'list', required: false }, { id: 'city', label: 'City', help: 'Where the client serves customers.', kind: 'text', required: false }, { id: 'serviceArea', label: 'Service area', help: 'The areas the client actually serves.', kind: 'text', required: false }, { id: 'wordpressUrl', label: 'WordPress address', help: 'For a later draft handoff, when needed.', kind: 'text', required: false }],
} as const;
const exact = (raw: unknown, keys: string[], required: string[] = keys): Record<string, unknown> => { if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(raw, key)))
    throw new EngineError('INVALID_VENTURE_REQUEST', 'Give the exact request fields.'); return raw as Record<string, unknown>; };
const need = (condition: unknown, code: string, words: string): void => { if (!condition)
    throw new EngineError(code, words); };
/** Each business keeps its own panels and observations, matching the engine vault scope. */
export function fakeSeoVisibilityDesk(host: W4DeskHost): FakePlaybookDesk {
    const businesses = new Map<string, Map<string, {
        panel: SeoPanelBody;
        observations: SeoObservationBody[];
    }>>();
    let sequence = 0;
    const current = () => { const business = host.current(); if (!businesses.has(business))
        businesses.set(business, new Map()); return businesses.get(business)!; };
    const item = (id: string) => { const entry = current().get(id); need(entry, 'PANEL_NOT_FOUND', 'That answer panel was not found.'); const { panel, observations } = entry!; const denominator = panel.spec.questions.length * panel.spec.engines.length * panel.spec.timepoints.length * panel.spec.repeats; const metrics = panel.state === 'approved' ? measuredPanel(panel, observations) : { mentions: { numerator: 0, denominator, missing: denominator }, filled: 0, minimumFilled: panel.spec.minimumFilled, status: 'not-enough-data', live: true, fixtures: 0, line: 'Approve this panel before collecting answers.' }; return { id, panel: structuredClone(panel), metrics, observations: structuredClone(observations) }; };
    const guarded = <T,>(run: () => T): T => { try {
        return run();
    }
    catch (error) {
        if (error instanceof Error && 'code' in error)
            throw new EngineError(String(error.code), error.message);
        throw error;
    } };
    return { playbook: 'seo-visibility', kinds: { ...fakeSeoPublishingKinds(host), strategy:fakeSeoStrategyKind(host), work: fakeSeoWorkKind(host), monitor: fakeSeoMonitorKind(host), website: fakeSeoWebsiteKind(host), panel: {
                list(p) { return guarded(() => { const body = exact(p, ['playbook', 'kind', 'filter'], ['playbook', 'kind']); need(body.filter === undefined || body.filter === null, 'INVALID_VENTURE_REQUEST', 'This panel list has no filters.'); const rows = [...current().keys()].map(id => { const view = item(id); return { id, state: view.panel.state, questionCount: view.panel.spec.questions.length, slots: view.metrics.mentions.denominator, filled: view.metrics.filled, missing: view.metrics.mentions.missing, live: view.metrics.live }; }); return { playbook: 'seo-visibility', kind: 'panel', rows, line: rows.length ? 'Answer panels, with missing slots kept in.' : 'No answer panel yet.' }; }); },
                get(p) { return guarded(() => { const body = exact(p, ['playbook', 'kind', 'id']); const view = item(String(body.id)); return { playbook: 'seo-visibility', kind: 'panel', item: view, digest: host.digest(view) }; }); },
                act(p) {
                    return guarded(() => {
                        const body = exact(p, ['playbook', 'kind', 'id', 'action', 'payload', 'digest'], ['playbook', 'kind', 'id', 'action', 'payload']);
                        need(typeof body.id === 'string' && typeof body.action === 'string', 'INVALID_VENTURE_REQUEST', 'Choose a panel and an action.');
                        let id = body.id as string;
                        if (body.action === 'create') {
                            need(id === 'new' && body.digest === undefined, 'INVALID_VENTURE_REQUEST', 'A new panel has no prior digest.');
                            const input = exact(body.payload, ['spec', 'orderId']);
                            need(input.orderId === null || typeof input.orderId === 'string', 'INVALID_VENTURE_REQUEST', 'Choose an order or no order.');
                            if (input.orderId !== null) {
                                const orders = host.ask('venture.order.list', {}) as OrderLite[];
                                need(orders.some(order => order.id === input.orderId), 'ORDER_NOT_FOUND', 'That order was not found.');
                            }
                            const panel = { ...newPanel(input.spec), orderId: input.orderId as string | null };
                            id = 'seopanel_' + (++sequence);
                            current().set(id, { panel, observations: [] });
                        }
                        else {
                            const view = item(id);
                            need(typeof body.digest === 'string' && body.digest === host.digest(view), 'PANEL_STALE', 'This answer panel changed. Open it again.');
                            const entry = current().get(id)!;
                            if (body.action === 'approve') {
                                exact(body.payload, []);
                                entry.panel = frozenPanel(entry.panel, host.digest);
                            }
                            else if (body.action === 'edit') {
                                const input = exact(body.payload, ['spec']);
                                entry.panel = changedPanel(entry.panel, input.spec);
                            }
                            else if (body.action === 'observe') {
                                const observation = checkedObservation(entry.panel, body.payload);
                                need(!entry.observations.some(item => item.slot === observation.slot), 'PANEL_SLOT_FILLED', 'That panel slot already has an answer.');
                                if (observation.method === 'owner-capture') {
                                    const files = host.ask('venture.files.list', {}) as UploadLite[];
                                    const file = files.find(file => file.id === observation.screenshotFileId);
                                    need(file?.format === 'image', 'PANEL_SCREENSHOT_REQUIRED', 'Upload the capture screenshot before recording the answer.');
                                    if (entry.panel.orderId)
                                        need((file!.scope.kind === 'order' || file!.scope.kind === 'media') && file!.scope.orderId === entry.panel.orderId, 'PANEL_SCREENSHOT_REQUIRED', 'Choose a screenshot from this panel order.');
                                }
                                need(observation.method !== 'api' || observation.fixture, 'PANEL_API_PLANNED', 'Live API collection is planned. Capture the answer with a screenshot instead.');
                                entry.observations.push({ ...observation, panelId: id });
                            }
                            else
                                need(false, 'INVALID_VENTURE_REQUEST', 'This panel action is not available.');
                        }
                        host.emit({ type: 'desk.changed', businessId: host.current(), playbook: 'seo-visibility', id } as never);
                        return { playbook: 'seo-visibility', kind: 'panel', id, result: item(id), line: body.action === 'approve' ? 'Panel approved and frozen.' : 'Answer panel saved.' };
                    });
                },
            } } };
}
