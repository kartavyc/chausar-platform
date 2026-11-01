// Chausar venture launcher, UI as data (wave 6, package 6H3, decision D40): each owner's layout of Today and Money,
// stored as one record per change (the newest is in use), and the owner's AI asking the app to open a place. The rules
// and the block library are in layout-core.ts, which the fake engine imports too.
//
// venture.layout.get { place } (read) answers the blocks in the order the page draws them, the saved views, the AI's
// changes since the owner's own last change (with one Undo for all of them) and the AI's latest request to open a place.
// venture.layout.change { place, change } (prepare, app only) is the owner's change; the AI's changes come through the
// MCP tools in agent-runtime/ui-tools.ts and are stored as made by the AI. Every change returns its exact Undo (a
// restore to the layout before it) and emits queue.changed, which carries no words, so open screens read again. Nothing here touches a setting,
// an approval, a limit or a receipt: those stay where they are and keep asking.
import { check, type Context, type State } from '../../contracts.ts';
import type { LayoutGoRecord, LayoutRecord, VentureDeps, VentureRecord } from '../contracts.ts';
import { exactPayload, listRecords, requireAppChannel, ventureAction } from '../records.ts';
import { readAs } from '../delivery/shared.ts';
import {
  applyChange, defaultLayout, describeBlocks, isCustom, KEEP_LINE, layoutPlace, LAYOUT_LIBRARY, navigation, normalizeLayout, parseChange, restoreLine,
  type LayoutBlockView, type LayoutBy, type LayoutChange, type LayoutPlace, type LayoutRequest, type LayoutState,
} from './layout-core.ts';

/** At most this many of the AI's lines are shown to the owner at once (the count says how many there were). */
const AI_LINES = 3;

export type LayoutView = {
  place: LayoutPlace; title: string; href: string; blocks: LayoutBlockView[]; views: { id: string; name: string }[]; custom: boolean;
  /** The AI's changes since the owner's own last change; undo puts back the layout from before the first of them. */
  ai: { count: number; lines: string[]; undo: LayoutRequest } | null;
  /** The AI's latest request to open a place. The app opens it once, when it is new. */
  go: { id: string; href: string; title: string; at: string } | null;
};
export type LayoutChangeResult = { layout: LayoutView; undo: LayoutRequest; line: string };

const recordsOf = (state: State, venture: VentureRecord, memberId: string, place: LayoutPlace) =>
  listRecords(state, 'venture-layout', venture.id).filter(record => record.memberId === memberId && record.place === place);
const stateOf = (place: LayoutPlace, record: LayoutRecord | undefined): LayoutState => (record ? normalizeLayout(place, record.state) : defaultLayout(place));

export function layoutView(state: State, venture: VentureRecord, memberId: string, place: LayoutPlace): LayoutView {
  const records = recordsOf(state, venture, memberId, place);
  const current = stateOf(place, records.at(-1));
  let first = records.length;
  while (first > 0 && records[first - 1]!.by === 'ai') first -= 1;
  const byAi = records.slice(first);
  const before = records[first - 1];
  const go = listRecords(state, 'venture-layout-go', venture.id).filter(record => record.memberId === memberId).at(-1);
  const { title, href } = LAYOUT_LIBRARY[place];
  return {
    place, title, href, blocks: describeBlocks(place, current), views: current.views.map(({ id, name }) => ({ id, name })), custom: isCustom(place, current),
    ai: byAi.length ? { count: byAi.length, lines: byAi.slice(-AI_LINES).map(record => record.line), undo: { place, change: { op: 'restore', to: before?.id ?? 'default' } } } : null,
    go: go ? { id: go.id, href: go.href, title: go.title, at: go.at } : null,
  };
}

export async function layoutGetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<LayoutView> {
  const body = exactPayload(payload, ['place'], ['place']);
  const place = layoutPlace(body.place);
  const { state, venture } = readAs(deps, ctx, 'read');
  return layoutView(state, venture, ctx.memberId, place);
}

/** One change to a place's layout, by the owner (the app) or the owner's AI (the MCP tools). */
export async function changeLayout(deps: VentureDeps, ctx: Context, place: LayoutPlace, change: LayoutChange, by: LayoutBy): Promise<LayoutChangeResult> {
  check(change.op !== 'keep' || by === 'owner', 'LAYOUT_LOCKED', 'Only the owner can keep the AI\'s changes.');
  return ventureAction(deps, ctx, 'prepare', by === 'ai' ? 'layout.ai' : 'layout.change', tx => {
    const venture = tx.venture!;
    const records = recordsOf(tx.state, venture, ctx.memberId, place);
    const latest = records.at(-1);
    const current = stateOf(place, latest);
    let next: { state: LayoutState; line: string };
    if (change.op === 'restore') {
      const target = change.to === 'default' ? undefined : records.find(record => record.id === change.to);
      check(change.to === 'default' || target, 'LAYOUT_NOT_FOUND', 'That earlier layout was not found.');
      next = { state: target ? stateOf(place, target) : defaultLayout(place), line: restoreLine(by) };
    } else if (change.op === 'keep') {
      next = { state: current, line: KEEP_LINE };
    } else {
      next = applyChange(place, current, change, by);
    }
    tx.put<LayoutRecord>({ ...tx.base('venture-layout'), place, state: next.state, by, line: next.line, op: change.op });
    tx.emit('queue.changed', {});
    return { layout: layoutView(tx.state, venture, ctx.memberId, place), undo: { place, change: { op: 'restore', to: latest?.id ?? 'default' } }, line: next.line };
  });
}

export async function layoutChangeHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<LayoutChangeResult> {
  requireAppChannel(ctx, 'venture.layout.change');
  const body = exactPayload(payload, ['place', 'change'], ['place', 'change']);
  const place = layoutPlace(body.place);
  const change = parseChange(body.change);
  readAs(deps, ctx, 'prepare');
  return changeLayout(deps, ctx, place, change, 'owner');
}

/** The owner's AI asks the app to open a place (and a page in it). Stored as data; the app opens it once. */
export async function layoutGo(deps: VentureDeps, ctx: Context, place: unknown, sub: unknown): Promise<{ href: string; line: string }> {
  const target = navigation(place, sub);
  return ventureAction(deps, ctx, 'prepare', 'layout.go', tx => {
    tx.put<LayoutGoRecord>({ ...tx.base('venture-layout-go'), href: target.href, title: target.title });
    tx.emit('queue.changed', {});
    return { href: target.href, line: `Your AI opened ${target.title}.` };
  });
}
