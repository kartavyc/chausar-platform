// Browser-safe panel validation shared with the demo engine. GEOHub (AGPL, ideas only); no source copied.
import type { PanelSpec, SeoObservationBody, SeoPanelBody } from './records.ts';
export type PanelFailure = (code: string, words: string) => never;
const fail: PanelFailure = (code, words) => { throw Object.assign(new Error(words), { code }); };
const need = (ok: unknown, words: string): void => { if (!ok)
    fail('PANEL_INVALID', words); };
const exact = (raw: unknown, keys: string[]): Record<string, unknown> => {
    need(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'Give the exact panel fields.');
    const value = raw as Record<string, unknown>;
    need(Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key)), 'Give the exact panel fields.');
    return value;
};
const timestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(value);
/** Validate the frozen experimental design before any answer can count. */
export function validatePanelSpec(raw: unknown): PanelSpec {
    const p = exact(raw, ['questions', 'engines', 'timepoints', 'repeats', 'minimumFilled']);
    need(Array.isArray(p.questions) && p.questions.length >= 15 && p.questions.length <= 30, 'Give between fifteen and thirty buyer questions.');
    const questions = (p.questions as unknown[]).map(rawQuestion => { const q = exact(rawQuestion, ['id', 'text']); need(id(q.id) && typeof q.text === 'string' && q.text.trim().length > 0 && q.text.length <= 500, 'Each buyer question needs a short id and words.'); return { id: q.id as string, text: (q.text as string).trim() }; });
    need(new Set(questions.map(q => q.id)).size === questions.length, 'Question ids must be different.');
    need(Array.isArray(p.engines) && p.engines.length >= 1 && p.engines.length <= 4 && p.engines.every(id), 'Give one to four engine ids.');
    const engines = p.engines as string[];
    need(new Set(engines).size === engines.length, 'Engine ids must be different.');
    need(Array.isArray(p.timepoints) && p.timepoints.length >= 1 && p.timepoints.length <= 8, 'Give collection windows.');
    const timepoints = (p.timepoints as unknown[]).map(rawTime => { const t = exact(rawTime, ['id', 'from', 'to']); need(id(t.id) && timestamp(t.from) && timestamp(t.to) && Date.parse(t.from) < Date.parse(t.to), 'Each window needs an id and increasing UTC timestamps.'); return { id: t.id as string, from: t.from as string, to: t.to as string }; });
    need(new Set(timepoints.map(t => t.id)).size === timepoints.length, 'Window ids must be different.');
    need(Number.isInteger(p.repeats) && (p.repeats as number) >= 1 && (p.repeats as number) <= 10, 'Repeats must be whole and bounded.');
    const slots = questions.length * engines.length * timepoints.length * (p.repeats as number);
    need(slots <= 2000 && Number.isInteger(p.minimumFilled) && (p.minimumFilled as number) >= 1 && (p.minimumFilled as number) <= slots, 'Give a minimum filled count within the bounded panel.');
    return { questions, engines: [...engines], timepoints, repeats: p.repeats as number, minimumFilled: p.minimumFilled as number };
}
/** New panels have no approval or authority to collect paid API answers. */
export function newPanel(raw: unknown): SeoPanelBody { return { spec: validatePanelSpec(raw), state: 'draft', approvedDigest: null, orderId: null }; }
/** After approval even a harmless wording edit needs a new panel. */
export function changedPanel(panel: SeoPanelBody, raw: unknown): SeoPanelBody { if (panel.state === 'approved')
    fail('PANEL_FROZEN', 'This panel is approved and frozen. Make a new panel to change it.'); return { ...panel, spec: validatePanelSpec(raw) }; }
/** The supplied hash function belongs to the host, never the caller payload. */
export function frozenPanel(panel: SeoPanelBody, hash: (value: unknown) => string): SeoPanelBody { const spec = validatePanelSpec(panel.spec); return { ...panel, spec, state: 'approved', approvedDigest: hash(spec) }; }
/** Observation validity is checked against every part of its exact slot. */
export function checkedObservation(panel: SeoPanelBody, raw: unknown): SeoObservationBody {
    if (panel.state !== 'approved' || !panel.approvedDigest)
        fail('PANEL_APPROVAL_REQUIRED', 'Approve the panel before recording answers.');
    const p = exact(raw, ['questionId', 'engine', 'timepointId', 'repeat', 'capturedAt', 'method', 'screenshotFileId', 'answer', 'mentioned', 'fixture']);
    const window = panel.spec.timepoints.find(t => t.id === p.timepointId);
    need(panel.spec.questions.some(q => q.id === p.questionId) && panel.spec.engines.includes(p.engine as string) && window, 'This observation does not belong to a panel slot.');
    need(Number.isInteger(p.repeat) && (p.repeat as number) >= 1 && (p.repeat as number) <= panel.spec.repeats, 'Choose a repeat inside this panel.');
    need(timestamp(p.capturedAt) && Date.parse(p.capturedAt) >= Date.parse(window!.from) && Date.parse(p.capturedAt) <= Date.parse(window!.to), 'The capture time is outside its collection window.');
    need(p.method === 'owner-capture' || p.method === 'api', 'Declare how the answer was collected.');
    need(p.method === 'owner-capture' ? typeof p.screenshotFileId === 'string' && /^upload[_-][a-zA-Z0-9_-]+$/.test(p.screenshotFileId) : p.screenshotFileId === null, 'Owner captures need a screenshot file; API observations do not.');
    need(typeof p.answer === 'string' && p.answer.trim().length > 0 && p.answer.length <= 10000 && typeof p.mentioned === 'boolean' && typeof p.fixture === 'boolean', 'Record the captured answer and whether it names the client.');
    const slot = [p.questionId, p.engine, p.timepointId, p.repeat].join('|');
    return { panelId: '', panelDigest: panel.approvedDigest, questionId: p.questionId as string, engine: p.engine as string, timepointId: p.timepointId as string, repeat: p.repeat as number, capturedAt: p.capturedAt as string, method: p.method as 'owner-capture' | 'api', screenshotFileId: p.screenshotFileId as string | null, answer: p.answer as string, mentioned: p.mentioned as boolean, fixture: p.fixture as boolean, slot };
}
/** Count only checked, unique slots and keep every missing slot in the denominator. */
export function measuredPanel(panel: SeoPanelBody, observations: readonly SeoObservationBody[]) {
    const slots = new Map<string, SeoObservationBody>();
    for (const observation of observations) {
        const { panelId: _id, panelDigest, slot: _slot, ...input } = observation;
        need(panelDigest === panel.approvedDigest, 'The observation belongs to another approved panel.');
        const checked = checkedObservation(panel, input);
        if (slots.has(checked.slot))
            fail('PANEL_SLOT_FILLED', 'That panel slot already has an answer.');
        slots.set(checked.slot, checked);
    }
    const denominator = panel.spec.questions.length * panel.spec.engines.length * panel.spec.timepoints.length * panel.spec.repeats;
    const numerator = [...slots.values()].filter(item => item.mentioned).length;
    const fixtures = [...slots.values()].filter(item => item.fixture).length;
    const enough = slots.size >= panel.spec.minimumFilled;
    const live = fixtures === 0;
    return { mentions: { numerator, denominator, missing: denominator - slots.size }, filled: slots.size, minimumFilled: panel.spec.minimumFilled, status: enough ? 'measured' : 'not-enough-data', live, fixtures, line: (enough ? 'Captured slots counted.' : 'Not enough data.') + (live ? ' API answers can differ from consumer apps.' : ' Recorded fixtures are not live visibility evidence.') };
}
