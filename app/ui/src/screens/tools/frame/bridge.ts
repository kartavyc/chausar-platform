/**
 * The small-app frame (TL-02): what the host sends into the locked frame and what it accepts back.
 *
 * The frame is an `<iframe sandbox="allow-scripts">` with a `srcdoc` and no `allow-same-origin`,
 * so it runs on a unique opaque origin: it cannot read the app, its storage or the engine, and the
 * app cannot be reached from it except through `postMessage`. The only script in it is Chausar's
 * own fixed renderer (`app/ui/public/smallapp-frame.js`, served at `/ui/smallapp-frame.js`); a small
 * app carries no code. The host builds a declarative view from the engine's reply (every value is a
 * display string from the shared format module of an engine figure with its receipt id; missing is
 * words), posts it in, and accepts back only these messages, each with the frame's random channel,
 * exact keys and values it knows: `ready`, `size`, `receipt` (a receipt id it sent), `book` (a records
 * card it sent) and `press` (an action card it sent, with one plain value per declared form field).
 */
import type { Language } from '../../../app/presentation.ts';
import type { FigureOrMissing } from '../../../app/presentation.ts';
import type { Opened, OpenCard, Value } from '../adapters/smallapps.ts';
import { formOf, type FormField, type PayloadSchema, type Typed } from './schema.ts';

export type Say = (key: string, values?: Readonly<Record<string, string | number>>) => string;

export type FrameValue =
  | { readonly kind: 'figures'; readonly items: readonly { readonly label: string; readonly display: string; readonly receiptId: string }[]; readonly note: string | null }
  | { readonly kind: 'missing'; readonly words: string; readonly receiptId: string | null; readonly open: string };
export type FrameCard =
  | { readonly kind: 'metric'; readonly id: string; readonly label: string; readonly value: FrameValue }
  | { readonly kind: 'chart'; readonly id: string; readonly label: string; readonly caption: string;
      readonly bars: readonly { readonly label: string; readonly value: FrameValue; readonly share: number }[] }
  | { readonly kind: 'action'; readonly id: string; readonly label: string; readonly note: string; readonly press: boolean; readonly fillable: boolean;
      readonly button: string; readonly fields: readonly (FormField & { readonly label: string; readonly hint: string | null })[]; readonly yes: string; readonly pick: string }
  | { readonly kind: 'records'; readonly id: string; readonly label: string; readonly lines: readonly string[]; readonly empty: string | null; readonly open: string };
export interface FrameView { readonly lang: Language; readonly title: string; readonly cards: readonly FrameCard[]; readonly empty: string | null }

/** What the host knows about the view it sent: the only ids it will act on. */
export interface Known {
  readonly receipts: ReadonlySet<string>;
  readonly actions: ReadonlyMap<string, { readonly schema: PayloadSchema | null; readonly form: readonly FormField[] }>;
  readonly records: ReadonlySet<string>;
}

const MISSING_KEY: Readonly<Record<string, string>> = {
  'absent': 'missing.absent', 'null': 'missing.null', 'unknown': 'missing.unknown', 'withheld': 'missing.withheld',
  'not-applicable': 'missing.notApplicable', 'not-loaded-yet': 'missing.notLoadedYet', 'not-counted': 'missing.notCounted',
};
function missingWords(f: FigureOrMissing, say: Say): string {
  return f.kind === 'missing' ? say(MISSING_KEY[f.missing] ?? 'missing.unknown') : say('missing.unknown');
}

function frameValue(v: Value, say: Say, partial: string): FrameValue {
  if (v.kind === 'missing') return { kind: 'missing', words: missingWords(v.figure, say), receiptId: v.receiptId, open: say('frame.openReceipt') };
  return {
    kind: 'figures', note: v.partial ? partial : null,
    items: v.items.map((i) => ({ label: i.label, display: i.figure.kind === 'missing' ? missingWords(i.figure, say) : i.figure.display, receiptId: v.receiptId })),
  };
}

/** The exact value of a single-figure value, for the length of its bar only; nothing is shown from it. */
function exactOf(v: Value): bigint | null {
  if (v.kind !== 'figures' || v.items.length !== 1) return null;
  const f = v.items[0]!.figure;
  return f.kind === 'missing' ? null : BigInt(f.exact);
}
/** Bar lengths in thousandths of the longest bar. Presentation only: no figure is made from them. */
export function shares(values: readonly Value[]): number[] {
  const exact = values.map(exactOf);
  const max = exact.reduce<bigint>((m, x) => (x !== null && x > m ? x : m), 0n);
  return exact.map((x) => (x === null || x <= 0n || max === 0n ? 0 : Number((x * 1000n) / max)));
}

function chart(id: string, label: string, rows: readonly { label: string; value: Value }[], say: Say, partial: string): FrameCard {
  const lengths = shares(rows.map((r) => r.value));
  return { kind: 'chart', id, label, caption: say('frame.chartCaption'), bars: rows.map((r, i) => ({ label: r.label, value: frameValue(r.value, say, partial), share: lengths[i]! })) };
}

/** The action's form, or none: absent or null details mean the action takes nothing typed. */
export function actionForm(schema: PayloadSchema | null | undefined): { fillable: boolean; form: readonly FormField[] } {
  if (schema === undefined || schema === null) return { fillable: true, form: [] };
  const form = formOf(schema);
  return form === null ? { fillable: false, form: [] } : { fillable: true, form };
}

function card(c: OpenCard, say: Say, partial: string, viewer: boolean, recordLine: (who: string, when: string) => string): FrameCard {
  switch (c.kind) {
    case 'metric': return { kind: 'metric', id: c.id, label: c.label, value: frameValue(c.value, say, partial) };
    case 'comparison': return chart(c.id, c.label, [{ label: say('frame.current'), value: c.current }, { label: say('frame.previous'), value: c.previous }], say, partial);
    case 'table': return chart(c.id, c.label, c.rows, say, partial);
    case 'action': {
      const { fillable, form } = actionForm(c.schema);
      const note = c.press === 'unavailable' ? say('frame.actionUnavailable') : !fillable ? say('frame.cannotFill') : c.alwaysWaits ? say('frame.actionAlwaysWaits') : say('frame.actionNote');
      return {
        kind: 'action', id: c.id, label: c.label, note, fillable, press: c.press === 'prepares-for-approval' && !viewer && fillable,
        button: form.length === 0 ? c.label : say('frame.prepare'), yes: say('frame.yes'), pick: say('frame.pick'),
        fields: form.map((f) => ({ ...f, label: f.required ? f.name : say('frame.optional', { name: f.name }), hint: f.kind === 'rupees' ? say('frame.rupeesHint') : f.kind === 'date' ? say('frame.dateHint') : null })),
      };
    }
    case 'records': return {
      kind: 'records', id: c.id, label: c.label, lines: c.entries.map((e) => recordLine(e.who, e.when)),
      empty: c.entries.length === 0 ? say('frame.bookEmpty') : null, open: say('frame.openBook'),
    };
  }
}

export function buildView(opened: Opened, opts: { title: string; language: Language; viewer: boolean; say: Say; partial: string; recordLine: (who: string, when: string) => string }): { view: FrameView; known: Known } {
  const cards = opened.cards.map((c) => card(c, opts.say, opts.partial, opts.viewer, opts.recordLine));
  const receipts = new Set<string>();
  const addValue = (v: Value) => { if (v.kind === 'figures') receipts.add(v.receiptId); else if (v.receiptId !== null) receipts.add(v.receiptId); };
  const actions = new Map<string, { schema: PayloadSchema | null; form: readonly FormField[] }>();
  const records = new Set<string>();
  for (const c of opened.cards) {
    if (c.kind === 'metric') addValue(c.value);
    if (c.kind === 'comparison') { addValue(c.current); addValue(c.previous); }
    if (c.kind === 'table') c.rows.forEach((r) => addValue(r.value));
    if (c.kind === 'action' && c.press === 'prepares-for-approval' && !opts.viewer) {
      const { fillable, form } = actionForm(c.schema);
      if (fillable) actions.set(c.id, { schema: c.schema ?? null, form });
    }
    if (c.kind === 'records') records.add(c.id);
  }
  return { view: { lang: opts.language, title: opts.title, cards, empty: cards.length === 0 ? opts.say('frame.noCards') : null }, known: { receipts, actions, records } };
}

// ---- messages from the frame ----

export type Inbound =
  | { readonly type: 'ready' }
  | { readonly type: 'size'; readonly height: number }
  | { readonly type: 'receipt'; readonly receiptId: string }
  | { readonly type: 'book'; readonly cardId: string }
  | { readonly type: 'press'; readonly cardId: string; readonly fields: Typed };

const SHAPES: Readonly<Record<Inbound['type'], readonly string[]>> = {
  ready: ['channel', 'type'], size: ['channel', 'type', 'height'], receipt: ['channel', 'type', 'receiptId'],
  book: ['channel', 'type', 'cardId'], press: ['channel', 'type', 'cardId', 'fields'],
};
function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/** A message from the frame, if it is exactly one the host accepts now; anything else is dropped. */
export function readInbound(data: unknown, channel: string, known: Known): Inbound | null {
  if (!plain(data) || data['channel'] !== channel || typeof data['type'] !== 'string' || !Object.hasOwn(SHAPES, data['type'])) return null;
  const type = data['type'] as Inbound['type'];
  const keys = Object.keys(data).sort();
  if (keys.length !== SHAPES[type].length || !SHAPES[type].every((k) => keys.includes(k))) return null;
  switch (type) {
    case 'ready': return { type };
    case 'size': {
      const h = data['height'];
      return Number.isSafeInteger(h) && (h as number) >= 0 && (h as number) <= 20000 ? { type, height: h as number } : null;
    }
    case 'receipt': {
      const id = data['receiptId'];
      return typeof id === 'string' && known.receipts.has(id) ? { type, receiptId: id } : null;
    }
    case 'book': {
      const id = data['cardId'];
      return typeof id === 'string' && known.records.has(id) ? { type, cardId: id } : null;
    }
    case 'press': {
      const id = data['cardId'], fields = data['fields'];
      const action = typeof id === 'string' ? known.actions.get(id) : undefined;
      if (action === undefined || !plain(fields)) return null;
      const names = Object.keys(fields);
      if (names.length > action.form.length) return null;
      for (const n of names) {
        const f = action.form.find((x) => x.name === n);
        const v = fields[n];
        if (f === undefined) return null;
        if (f.kind === 'yesno' ? typeof v !== 'boolean' : typeof v !== 'string' || v.length > 4000) return null;
      }
      return { type, cardId: id as string, fields: { ...fields } as Typed };
    }
  }
}

// ---- the frame document ----

/** A fresh random channel for one frame. */
export function newChannel(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const escapeAttr = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Where the frame's two files are served (the app's own origin; the desktop CSP allows only these). */
export const FRAME_ASSETS = { script: '/ui/smallapp-frame.js', style: '/ui/host.css' } as const;

/**
 * The frame's document. It holds no data: the view arrives by message. Its own policy allows only
 * the renderer script and the app's stylesheet and fonts from the app's origin (named, because
 * `'self'` means nothing on an opaque origin), and no network, forms or plugins; the app's own
 * policy, which a srcdoc frame inherits, still applies on top.
 */
export function frameDocument(channel: string, language: Language, title: string, origin: string): string {
  if (!/^[a-f0-9]{32}$/.test(channel)) throw new Error('INVALID_CHANNEL');
  if (!/^[a-z][a-z0-9+.-]{0,31}:\/\/[A-Za-z0-9.-]{1,253}(?::\d{1,5})?$/.test(origin)) throw new Error('INVALID_ORIGIN');
  return '<!doctype html>'
    + `<html lang="${language}" data-channel="${channel}">`
    + '<head><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${origin}${FRAME_ASSETS.script}; style-src ${origin}${FRAME_ASSETS.style}; font-src ${origin}; img-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'">`
    + `<title>${escapeAttr(title)}</title>`
    + `<link rel="stylesheet" href="${origin}${FRAME_ASSETS.style}">`
    + '</head>'
    + '<body><main id="app"></main>'
    + `<script src="${origin}${FRAME_ASSETS.script}"></script>`
    + '</body></html>';
}
