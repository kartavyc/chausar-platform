/** TR-02 markings: personal, financial and confidential, on a source, a record or a field, and what each seat sees. */
import { authorize, audit, check, hash, newId, now } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { boundedText, coreState, defaultSees, knownSources, markKinds, peekCore, seatNames } from './core-state.ts';
import type { Mark, MarkKind, MarkTarget, Seat, Sees } from './core-state.ts';
import { onApplyChange, requestChange } from './core-dual.ts';

/** Bank data is marked financial from the start: a source id or import type naming a bank. */
export function bankSources(state: State): string[] {
  const banks = new Set(knownSources(state).filter(id => /bank/i.test(id)));
  for (const i of state.imports) if (typeof i?.sourceId === 'string' && [i.type, i.format, i.system].some(v => typeof v === 'string' && /bank/i.test(v))) banks.add(i.sourceId);
  return [...banks].sort();
}
function firstSeen(state: State, sourceId: string): string {
  const dates = [...state.facts.filter(f => f.sourceId === sourceId).map(f => f.learnedAt), ...state.imports.filter(i => i?.sourceId === sourceId).map(i => i.at ?? i.createdAt)].filter(d => typeof d === 'string').sort();
  return dates[0] ?? state.workspace.createdAt;
}
/** Every mark in force: the stored ones plus the automatic financial mark on bank sources not turned off. */
export function allMarks(state: State): Mark[] {
  const core = peekCore(state); const known = new Set(knownSources(state));
  const auto = bankSources(state).filter(id => !core.autoOff.includes(id)).map(sourceId => ({ id: `mark_auto_${hash(sourceId).slice(0, 16)}`, kind: 'financial' as const,
    target: { type: 'source' as const, sourceId }, auto: true, by: 'chausar', at: firstSeen(state, sourceId) }));
  return [...auto, ...core.marks.filter(m => known.has(m.target.sourceId))].sort((a, b) => b.at.localeCompare(a.at));
}
/** The kinds of marking carried by data from these sources, so a marking follows it into reports, briefs and exports. */
export function markingsForSources(state: State, sourceIds: readonly string[]): MarkKind[] {
  const wanted = new Set(sourceIds); const kinds = new Set(allMarks(state).filter(m => wanted.has(m.target.sourceId)).map(m => m.kind));
  return markKinds.filter(k => kinds.has(k));
}
/** The kinds marked on a whole source, the automatic bank mark included; cheap enough to ask for each fact. */
export function sourceMarkKinds(state: State, sourceId: string): MarkKind[] {
  const core = peekCore(state); const kinds = new Set(core.marks.filter(m => m.target.type === 'source' && m.target.sourceId === sourceId).map(m => m.kind));
  if (!core.autoOff.includes(sourceId) && (/bank/i.test(sourceId) || state.imports.some(i => i?.sourceId === sourceId && [i.type, i.format, i.system].some(v => typeof v === 'string' && /bank/i.test(v))))) kinds.add('financial');
  return markKinds.filter(k => kinds.has(k));
}
export function seatSees(state: State, seat: Seat): Sees { return seat === 'owner' ? { ...defaultSees.owner } : { ...defaultSees[seat], ...(peekCore(state).seatSees[seat] ?? {}) }; }

export function markingsView(state: State) {
  return { kinds: [...markKinds], marks: structuredClone(allMarks(state)), seats: seatNames.map(seat => ({ seat, sees: seatSees(state, seat) })),
    where: { source: 'books/sources', record: 'books/customers', field: 'books/meanings' } };
}

function validTarget(state: State, target: any): MarkTarget {
  check(target && typeof target === 'object' && ['source', 'record', 'field'].includes(target.type), 'INVALID_MARKING', 'Mark a source, a record or a field.');
  check(boundedText(target.sourceId) && knownSources(state).includes(target.sourceId), 'SOURCE_NOT_FOUND', 'This source does not exist in the workspace.');
  if (target.type !== 'source') check(boundedText(target.recordId), 'INVALID_MARKING', 'Name the record to mark.');
  if (target.type === 'field') check(boundedText(target.field, 100), 'INVALID_MARKING', 'Name the field to mark.');
  return { type: target.type, sourceId: target.sourceId, ...(target.type !== 'source' ? { recordId: target.recordId } : {}), ...(target.type === 'field' ? { field: target.field } : {}) };
}
const sameTarget = (a: MarkTarget, b: MarkTarget) => a.type === b.type && a.sourceId === b.sourceId && a.recordId === b.recordId && a.field === b.field;

// Narrowing what a seat sees applies at once; widening it (a seat seeing a kind, a marking turned off) is under dual control.
export async function setMarking(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  check(markKinds.includes(payload.kind), 'INVALID_MARKING', 'Choose personal, financial or confidential.');
  check(typeof payload.on === 'boolean', 'INVALID_MARKING', 'Say whether the marking is on or off.');
  const state = host.store.read(); const target = validTarget(state, payload.target); const kind = payload.kind as MarkKind;
  const op = { type: 'marking', kind, target, on: payload.on };
  if (payload.on || !allMarks(state).some(m => m.kind === kind && sameTarget(m.target, target))) return applyMarking(ctx, host, op);
  const where = target.type === 'source' ? `source ${target.sourceId}` : `a ${target.type} in source ${target.sourceId}`;
  const result = await requestChange(ctx, host, 'markings', `Turn off the ${kind} marking on ${where}.`, op);
  return result.state === 'applied' ? markingsView(host.store.read()) : result;
}

async function applyMarking(ctx: Context, host: ModuleHost, op: Record<string, unknown>) {
  return host.store.update(state => {
    authorize({ read: () => state, update: host.store.update.bind(host.store) }, ctx, 'admin');
    const target = validTarget(state, op.target); const core = coreState(state); const kind = op.kind as MarkKind; const on = op.on === true;
    const automatic = kind === 'financial' && target.type === 'source' && bankSources(state).includes(target.sourceId);
    if (automatic) core.autoOff = on ? core.autoOff.filter(id => id !== target.sourceId) : [...new Set([...core.autoOff, target.sourceId])];
    else if (!on) core.marks = core.marks.filter(m => !(m.kind === kind && sameTarget(m.target, target)));
    else if (!core.marks.some(m => m.kind === kind && sameTarget(m.target, target))) core.marks.push({ id: newId('mark'), kind, target, auto: false, by: ctx.memberId, at: now() });
    audit(state, 'trustx.marking.changed', { kind, type: target.type, on, memberId: ctx.memberId });
    return markingsView(state);
  });
}
onApplyChange('marking', applyMarking);

export async function setSeatMarking(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  check(seatNames.includes(payload.seat), 'INVALID_SEAT', 'Choose an existing seat.');
  check(payload.seat !== 'owner', 'SEAT_FIXED', 'The owner always sees everything.');
  check(markKinds.includes(payload.kind) && typeof payload.sees === 'boolean', 'INVALID_MARKING', 'Choose a marking and whether the seat sees it.');
  const op = { type: 'seat-sees', seat: payload.seat, kind: payload.kind, sees: payload.sees };
  if (!payload.sees || seatSees(host.store.read(), payload.seat)[payload.kind as MarkKind]) return applySeatMarking(ctx, host, op);
  const result = await requestChange(ctx, host, 'markings', `Let the ${payload.seat} seat see data marked ${payload.kind}.`, op);
  return result.state === 'applied' ? markingsView(host.store.read()) : result;
}

async function applySeatMarking(ctx: Context, host: ModuleHost, op: Record<string, unknown>) {
  return host.store.update(state => {
    authorize({ read: () => state, update: host.store.update.bind(host.store) }, ctx, 'admin');
    const core = coreState(state); const seat = op.seat as Seat; const kind = op.kind as MarkKind;
    core.seatSees[seat] = { ...seatSees(state, seat), [kind]: op.sees === true };
    audit(state, 'trustx.seat-marking.changed', { seat, kind, sees: op.sees === true, memberId: ctx.memberId });
    return markingsView(state);
  });
}
onApplyChange('seat-sees', applySeatMarking);
