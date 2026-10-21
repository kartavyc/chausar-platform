// Chausar venture launcher, views (P1-A): run events for the Ink frontend.
// The venture actor stores run.started, run.step, run.waiting, run.done, run.failed and queue.changed in its event log
// (VENTURE_EVENTS). After a commit the venture host hands them to the engine (VentureHostOptions.notify), which pushes
// them to the desktop window over IPC and streams them to the web over Server-Sent Events at GET /api/events. A
// screen that hears one reads the queue or the run again: the event says only what changed, never the data itself.
// This file is a leaf: it imports no venture package, so the web servers can use it without loading the engine's views.
import { VENTURE_RUN_EVENT_TYPES } from '../contracts.ts';
import type { VentureRunEvent, VentureRunEventType } from '../contracts.ts';

/** An event as the hosted runtime hands it to listeners (platform/runtime/hosted/runtime/contract.ts ActorEvent). */
export type LoggedEvent = { seq?: number; name: string; data: unknown; at: string };

const ID = /^[A-Za-z0-9_.:-]{1,200}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

/** A logged event as a VentureRunEvent for one business, or null when it is not a run event. Only the run id is kept. */
export function runEventFromActor(event: LoggedEvent, businessId: string): VentureRunEvent | null {
  if (!(VENTURE_RUN_EVENT_TYPES as readonly string[]).includes(event.name) || !ID.test(businessId) || !ISO.test(event.at)) return null;
  const data = event.data && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data as Record<string, unknown> : {};
  const runId = typeof data.runId === 'string' && ID.test(data.runId) ? data.runId : undefined;
  return { type: event.name as VentureRunEventType, businessId, ...(runId ? { runId } : {}), at: event.at };
}

/** One Server-Sent Events frame: a default message whose data is the event as JSON. */
export function sseFrame(event: VentureRunEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** The stream's first lines: how long a browser waits before it reconnects. */
export const SSE_PREAMBLE = 'retry: 5000\n\n';
/** A comment line that keeps proxies from closing a quiet stream. */
export const SSE_HEARTBEAT = ': still here\n\n';
export const SSE_HEADERS = Object.freeze({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
