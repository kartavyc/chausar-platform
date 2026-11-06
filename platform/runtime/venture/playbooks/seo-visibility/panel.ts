// Chausar persisted panel domain interface. GEOHub (AGPL, ideas only); no copied source.
import { ChausarError } from '../../../contracts.ts';
import { digest } from '../../records.ts';
import { newPanel, changedPanel, frozenPanel, checkedObservation, measuredPanel } from './panel-core.ts';
import type { SeoObservationBody, SeoPanelBody } from './records.ts';
function domain<T>(run: () => T): T { try {
    return run();
}
catch (error) {
    if (error instanceof Error && 'code' in error)
        throw new ChausarError(String(error.code), error.message);
    throw error;
} }
/** Create a validated draft panel. */
export function makePanel(raw: unknown): SeoPanelBody { return domain(() => newPanel(raw)); }
/** Freeze exact questions, engines, repeats and windows by their digest. */
export function approvePanel(panel: SeoPanelBody): SeoPanelBody { return domain(() => frozenPanel(panel, digest)); }
/** Edit only before approval. */
export function editPanel(panel: SeoPanelBody, raw: unknown): SeoPanelBody { return domain(() => changedPanel(panel, raw)); }
/** Record only answers whose slot and capture method can be checked. */
export function observePanel(panel: SeoPanelBody, raw: unknown): SeoObservationBody { return domain(() => checkedObservation(panel, raw)); }
/** Counts carry missing observations rather than silently dropping them. */
export function panelMetrics(panel: SeoPanelBody, observations: readonly SeoObservationBody[]) { return domain(() => measuredPanel(panel, observations)); }
