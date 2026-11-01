// Chausar venture launcher, core (wave 6, 6C6 / D5, D21): the day-job and compliance check, as engine methods.
// venture.compliance.get { profession? } (read; also answered before any vault exists, so onboarding can show it when the
// profession is picked): the side-work question, the profession's rules, its regulator switch-offs and the hard stops,
// plus the recorded answer when a business is open. venture.compliance.set { profession, sideWork, digest } (approve, app
// only): records the profession and the owner's answer with the date. refuseRegulatorForbidden is the engine check the
// outreach, lead and posting methods call: a tool the profession's regulator forbids is refused whatever the settings or
// attestations say. The data is core/compliance-data.ts.
import { check, type Context, type State } from '../../contracts.ts';
import type { ComplianceRecord, ComplianceView, VentureDeps } from '../contracts.ts';
import { currentVenture, exactPayload, listRecords, requireAppChannel, ventureAction } from '../records.ts';
import { readAs } from '../delivery/shared.ts';
import { localDayAt } from '../local-day.ts';
import { HARD_STOP_WORDS } from '../policy/hard-stops.ts';
import { SIDE_WORK_ANSWERS, complianceOf, professionCompliance, type RegulatorTool, type SideWorkAnswer } from './compliance-data.ts';
import { signoffDeskSwitchOffs } from '../playbooks/signoff-desk/gate.ts';

const CHOOSE = 'Choose a profession.';
const STALE = 'The rules for this profession changed. Read them again.';

/** The newest compliance record of a business, or null. */
export function complianceRecordOf(state: State, ventureId: string): ComplianceRecord | null {
  return listRecords(state, 'venture-compliance', ventureId).at(-1) ?? null;
}

function viewOf(professionId: unknown, record: ComplianceRecord | null): ComplianceView {
  const item = professionCompliance(professionId);
  check(item, 'INVALID_VENTURE_REQUEST', CHOOSE);
  return { ...complianceOf(item), recorded: record ? { professionId: record.professionId, sideWork: record.sideWork, acknowledgedOn: record.acknowledgedOn } : null };
}

/** Before any vault exists: the profession's data only. */
export function complianceBeforeVault(payload: unknown): ComplianceView {
  const body = exactPayload(payload ?? {}, ['profession'], ['profession']);
  return viewOf(body.profession, null);
}

export async function complianceGet(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ComplianceView> {
  const body = exactPayload(payload ?? {}, ['profession']);
  const state = deps.store.read();
  const venture = currentVenture(state);
  if (venture) readAs(deps, ctx, 'read');
  const record = venture ? complianceRecordOf(state, venture.id) : null;
  return viewOf(body.profession ?? record?.professionId, record);
}

export async function complianceSet(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ComplianceView> {
  requireAppChannel(ctx, 'venture.compliance.set');
  const body = exactPayload(payload, ['profession', 'sideWork', 'digest'], ['profession', 'sideWork', 'digest']);
  const item = professionCompliance(body.profession);
  check(item, 'INVALID_VENTURE_REQUEST', CHOOSE);
  check(typeof body.sideWork === 'string' && (SIDE_WORK_ANSWERS as readonly string[]).includes(body.sideWork), 'INVALID_VENTURE_REQUEST', 'Answer the side-work question.');
  const pure = complianceOf(item);
  check(body.digest === pure.digest, 'APPROVAL_STALE', STALE);
  readAs(deps, ctx, 'approve');
  return ventureAction(deps, ctx, 'approve', 'compliance.set', tx => {
    const record = tx.put<ComplianceRecord>({
      ...tx.base('venture-compliance'), professionId: item.id, sideWork: body.sideWork as SideWorkAnswer,
      acknowledgedOn: localDayAt(tx.now, tx.venture!.country), digest: pure.digest, switchedOff: item.switchedOff.map(entry => entry.tool), memberId: ctx.memberId,
    });
    tx.emit('compliance-recorded', { professionId: item.id });
    return viewOf(item.id, record);
  });
}

/**
 * Refuses (REGULATOR_FORBIDS) a tool the business's profession's regulator forbids. Reads the recorded switch-offs and
 * the profession's current data together, so neither a later data change nor any setting turns a switch back on.
 */
export function refuseRegulatorForbidden(state: State, tool: RegulatorTool): void {
  const venture = currentVenture(state);
  if (!venture) return;
  // W6 6E5: a sign-off desk business also carries the switch-offs of every profession its plan serves, recorded or not.
  const desk = signoffDeskSwitchOffs(state, venture).find(entry => entry.tool === tool);
  check(!desk, 'REGULATOR_FORBIDS', `${desk?.line ?? ''} ${HARD_STOP_WORDS}`);
  const record = complianceRecordOf(state, venture.id);
  if (!record) return;
  const current = professionCompliance(record.professionId)?.switchedOff ?? [];
  const off = current.find(entry => entry.tool === tool);
  check(!off && !record.switchedOff.includes(tool), 'REGULATOR_FORBIDS', `${off?.line ?? "Your profession's regulator forbids this."} ${HARD_STOP_WORDS}`);
}
