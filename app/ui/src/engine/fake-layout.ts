/**
 * The fake engine's answers for a place's layout (wave 6 package 6H3, D40), as platform/runtime/venture/views/layout.ts
 * answers them: venture.layout.get and venture.layout.change, with the same block library, rules, refusals and words,
 * because both run layout-core.ts. One list of changes per business and place (the newest is in use), Undo as a restore
 * to the layout before the change, the AI's changes since the owner's own last one with one Undo, and every change
 * followed by queue.changed. The fake has no AI; `ai()` and `go()` stand in for Chausar's MCP tools in tests and the
 * demo, stored as made by the AI exactly as the engine stores them.
 */

import { applyChange, defaultLayout, describeBlocks, goLine, isCustom, KEEP_LINE, layoutPlace, LAYOUT_LIBRARY, navigation, normalizeLayout, parseChange, restoreLine } from '../../../../platform/shared/venture/views/layout-core.ts';
import type { LayoutBy, LayoutChange, LayoutState } from '../../../../platform/runtime/venture/views/layout-core.ts';
import { EngineError, type LayoutChangeResult, type LayoutPlace, type LayoutRequest, type LayoutView } from './types';

export const FAKE_LAYOUT_METHODS: ReadonlySet<string> = new Set(['venture.layout.get', 'venture.layout.change']);

interface Change { id: string; place: LayoutPlace; state: LayoutState; by: LayoutBy; line: string }
interface Go { id: string; href: string; title: string; at: string }

export interface LayoutHost {
  current(): string;
  now(): string;
  changed(): void;
}

const AI_LINES = 3;

function exact(p: unknown, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
  if (p === null || typeof p !== 'object' || Array.isArray(p) || ![Object.prototype, null].includes(Object.getPrototypeOf(p))) {
    throw new EngineError('INVALID_VENTURE_REQUEST', 'Send one request object.');
  }
  const record = p as Record<string, unknown>;
  if (!Object.keys(record).every((key) => allowed.includes(key)) || !required.every((key) => Object.hasOwn(record, key))) {
    throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
  }
  return record;
}

/** The engine's refusals arrive as EngineError with the same code and words. */
function engine<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof EngineError) throw error;
    const { code, message } = error as { code?: string; message?: string };
    throw new EngineError(code ?? 'INVALID_VENTURE_REQUEST', message ?? 'That change was refused.');
  }
}

export class FakeLayoutDesk {
  private readonly changes = new Map<string, Change[]>();
  private readonly goes = new Map<string, Go[]>();
  private seq = 0;
  constructor(private readonly host: LayoutHost) {}

  handles(method: string): boolean { return FAKE_LAYOUT_METHODS.has(method); }

  request(method: string, p: Record<string, unknown>): unknown {
    if (method === 'venture.layout.get') {
      const body = exact(p, ['place'], ['place']);
      return this.view(engine(() => layoutPlace(body.place)));
    }
    const body = exact(p, ['place', 'change'], ['place', 'change']);
    const place = engine(() => layoutPlace(body.place));
    const change = engine(() => parseChange(body.change));
    return this.change(place, change, 'owner');
  }

  /** Stands in for the AI's MCP tools (ui_arrange, ui_rename, ui_views): a change stored as made by the AI. */
  ai(request: LayoutRequest): LayoutChangeResult {
    return this.change(request.place, engine(() => parseChange(request.change)), 'ai');
  }

  /** Stands in for ui_navigate: an offer of a place the owner opens, never a page opened for them. */
  go(place: string, sub = ''): { href: string; line: string } {
    const target = engine(() => navigation(place, sub));
    const list = this.goes.get(this.host.current()) ?? [];
    list.push({ id: `layoutgo_${++this.seq}`, href: target.href, title: target.title, at: this.host.now() });
    this.goes.set(this.host.current(), list);
    this.host.changed();
    return { href: target.href, line: goLine(target.title) };
  }

  private list(place: LayoutPlace): Change[] {
    return (this.changes.get(this.host.current()) ?? []).filter((change) => change.place === place);
  }

  private stateOf(place: LayoutPlace, change: Change | undefined): LayoutState {
    return change ? normalizeLayout(place, change.state) : defaultLayout(place);
  }

  private view(place: LayoutPlace): LayoutView {
    const records = this.list(place);
    const current = this.stateOf(place, records.at(-1));
    let first = records.length;
    while (first > 0 && records[first - 1]!.by === 'ai') first -= 1;
    const byAi = records.slice(first);
    const before = records[first - 1];
    const go = (this.goes.get(this.host.current()) ?? []).at(-1);
    const { title, href } = LAYOUT_LIBRARY[place];
    return {
      place, title, href, blocks: describeBlocks(place, current), views: current.views.map(({ id, name }) => ({ id, name })), custom: isCustom(place, current),
      ai: byAi.length ? { count: byAi.length, lines: byAi.slice(-AI_LINES).map((record) => record.line), undo: { place, change: { op: 'restore', to: before?.id ?? 'default' } } } : null,
      go: go ? { ...go } : null,
    };
  }

  private change(place: LayoutPlace, change: LayoutChange, by: LayoutBy): LayoutChangeResult {
    if (change.op === 'keep' && by !== 'owner') throw new EngineError('LAYOUT_LOCKED', 'Only the owner can keep the AI\'s changes.');
    const records = this.list(place);
    const latest = records.at(-1);
    const current = this.stateOf(place, latest);
    let next: { state: LayoutState; line: string };
    if (change.op === 'restore') {
      const target = change.to === 'default' ? undefined : records.find((record) => record.id === change.to);
      if (change.to !== 'default' && !target) throw new EngineError('LAYOUT_NOT_FOUND', 'That earlier layout was not found.');
      next = { state: target ? this.stateOf(place, target) : defaultLayout(place), line: restoreLine(by) };
    } else if (change.op === 'keep') {
      next = { state: current, line: KEEP_LINE };
    } else {
      next = engine(() => applyChange(place, current, change, by));
    }
    const all = this.changes.get(this.host.current()) ?? [];
    all.push({ id: `layout_${++this.seq}`, place, state: structuredClone(next.state), by, line: next.line });
    this.changes.set(this.host.current(), all);
    this.host.changed();
    return { layout: this.view(place), undo: { place, change: { op: 'restore', to: latest?.id ?? 'default' } }, line: next.line };
  }
}
