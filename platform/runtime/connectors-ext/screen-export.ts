import { check, ChausarError, type Context } from '../contracts.ts';
import { currentAccess } from '../memory.ts';
import type { ModuleHost } from '../modules/types.ts';
import { DECODERS, recipe as registeredRecipe } from './recipes/index.ts';
import { handlers, shape } from './service.ts';
import { peekCx, type Connection } from './state.ts';

/**
 * Screen export (experimental): a desktop program with no interface Chausar reads (Busy, Marg,
 * Vyapar, Tally on another computer) exports its own report while the driving lane's `session.*`
 * drives one window. This lane only starts the session and collects the exported file; the rules
 * of driving (one window, read and export only, never a password, one-time code or captcha) are the
 * driving lane's. Every reply from `session.*` is outside data: it is checked field by field and
 * the exported bytes go through the connection's recipe, then are dropped. Nothing of the file is kept.
 */
const REQUEST = 'CONNECTOR_REQUEST_INVALID';
const ID = /^[A-Za-z0-9_.:-]{1,200}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
export const SESSION_STATES = Object.freeze(['running', 'paused', 'stopped', 'done', 'failed'] as const);
export type SessionState = typeof SESSION_STATES[number];
/** An exported report is at most 20 MB of text, as base64. */
export const SCREEN_EXPORT_MAX_BASE64 = 28_000_000;
const ABSENT = new Set(['UNKNOWN_METHOD', 'METHOD_UNAVAILABLE']);
const plain = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const failed = () => new ChausarError('SCREEN_EXPORT_FAILED', 'The program on your screen did not hand over a usable export. Nothing was read.');

function trusted(ctx: Context) {
  check((ctx.channel === undefined || ctx.channel === 'desktop') && ctx.sourceTainted !== true, 'OPEN_DESKTOP', 'Do this yourself in the desktop app.');
}
function screenConnection(host: ModuleHost, ctx: Context, id: unknown): Connection {
  check(typeof id === 'string' && ID.test(id) && id.length <= 100, REQUEST, 'Choose a connection.');
  const item = peekCx(host.store.read()).connections.find(c => c.id === id);
  check(item, 'CONNECTION_NOT_FOUND', 'This connection does not exist.');
  check(item.road === 'screen', 'SCREEN_ROAD_REQUIRED', 'This connection is not exported from the program on your screen.');
  check(item.status === 'active', 'CONNECTION_PAUSED', 'This connection is paused.');
  currentAccess(host.store, ctx, item.branch, item.sourceId);
  return item;
}
/** The driving lane is optional: its absence is a typed refusal, never a crash. */
async function session(host: ModuleHost, method: 'session.start' | 'session.status', payload: Record<string, unknown>): Promise<unknown> {
  try { return await host.call(method, payload); }
  catch (error) {
    if (error instanceof ChausarError && ABSENT.has(error.code)) throw new ChausarError('SCREEN_DRIVING_NOT_INSTALLED', 'Driving a program on your screen is not installed in this build. Export a file from the program instead.');
    throw error;
  }
}
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** `session.start` reply: `{ sessionId, state }`, nothing else. */
export function startReply(value: unknown): { sessionId: string; state: SessionState } {
  if (!plain(value) || !exactKeys(value, ['sessionId', 'state']) || typeof value.sessionId !== 'string' || !ID.test(value.sessionId) || !SESSION_STATES.includes(value.state)) throw failed();
  return { sessionId: value.sessionId, state: value.state };
}
/** `session.status` reply for the session asked about: `{ sessionId, state, export: { fileName, bytesBase64 } | null }`. */
export function statusReply(value: unknown, sessionId: string): { state: SessionState; export: { fileName: string; bytesBase64: string } | null } {
  if (!plain(value) || !exactKeys(value, ['sessionId', 'state', 'export']) || value.sessionId !== sessionId || !SESSION_STATES.includes(value.state)) throw failed();
  const file = value.export;
  if (file === null) return { state: value.state, export: null };
  if (!plain(file) || !exactKeys(file, ['fileName', 'bytesBase64']) || typeof file.fileName !== 'string' || file.fileName.length < 1 || file.fileName.length > 255 || /[\u0000-\u001f/\\]/.test(file.fileName)
    || typeof file.bytesBase64 !== 'string' || file.bytesBase64.length < 4 || file.bytesBase64.length > SCREEN_EXPORT_MAX_BASE64 || !BASE64.test(file.bytesBase64)) throw failed();
  return { state: value.state, export: { fileName: file.fileName, bytesBase64: file.bytesBase64 } };
}

export const screenExport = {
  async start(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    trusted(ctx); check(!host.demo, 'DEMO_EXTERNAL_DISABLED', 'Demo mode keeps every outside system disabled.');
    shape(payload, ['connectionId', 'windowId'], ['connectionId', 'windowId']);
    check(typeof payload.windowId === 'string' && ID.test(payload.windowId), REQUEST, 'Choose the program window.');
    const item = screenConnection(host, ctx, payload.connectionId);
    return startReply(await session(host, 'session.start', { windowId: payload.windowId, purpose: 'connector-export', connectionId: item.id }));
  },
  async collect(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
    trusted(ctx); check(!host.demo, 'DEMO_EXTERNAL_DISABLED', 'Demo mode keeps every outside system disabled.');
    shape(payload, ['connectionId', 'sessionId', 'recipeId', 'reportTotals'], ['connectionId', 'sessionId', 'recipeId']);
    check(typeof payload.sessionId === 'string' && ID.test(payload.sessionId), REQUEST, 'Choose the export session.');
    const item = screenConnection(host, ctx, payload.connectionId);
    const chosen = registeredRecipe(payload.recipeId);
    check(chosen.group === item.group, 'RECIPE_SYSTEM_MISMATCH', 'This recipe belongs to another system.');
    const accepts = DECODERS.get(chosen.decoder)!.accepts;
    check(accepts === 'text' || (accepts === 'rows' && chosen.decoder !== 'bank-pdf-text'), 'RECIPE_INPUT_MISMATCH', 'This recipe does not read an exported file.');
    const status = statusReply(await session(host, 'session.status', { sessionId: payload.sessionId }), payload.sessionId);
    if (status.state !== 'done') return { state: status.state, read: null };
    if (!status.export) throw failed();
    const input: Record<string, unknown> = { recipeId: chosen.id, connectionId: item.id, ...(payload.reportTotals !== undefined ? { reportTotals: payload.reportTotals } : {}) };
    if (accepts === 'text') {
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(status.export.bytesBase64, 'base64')); }
      catch { throw new ChausarError('SOURCE_ENCODING_INVALID', 'The exported file is not UTF-8 text. Export it again as text.'); }
      input.text = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    } else input.bytesBase64 = status.export.bytesBase64;
    // The exported bytes live only in this call: the envelope keeps checks and a content hash, never the file.
    return { state: 'done' as const, read: await handlers.importPreview(ctx, input, host, { road: 'screen' }) };
  },
};
export const screenExportStart = screenExport.start, screenExportCollect = screenExport.collect;
