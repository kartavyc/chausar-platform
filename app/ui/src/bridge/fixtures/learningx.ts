/**
 * Synthetic learning-ext replies for previews and tests, in the shapes of
 * `platform/runtime/learning-ext/dictionary.ts` and `sharing.ts`. The fake engine serves them by
 * default (`learningxFakeHandlers`), after any handlers a test registers with
 * `registerFakeMethods('learningx', ...)`, so previews draw FR-07's "Proposed meanings (draft)"
 * and FR-10's sharing question without registering anything.
 *
 * The draft is the shape of `learningx.dictionaryBuild`: header names and inferred kinds only,
 * never cell values. The sharing batch holds structure-only vocabulary tokens, never a value.
 * Only previews and tests import this.
 */
import type { FakeHandler } from '../fake.ts';
import { sha256Hex } from './shop.ts';

const CORE = new Set(['id', 'kind', 'type', 'date', 'branch']);
const AMOUNT = /(amount|price|total|value|cost|fee|tax|paid)/i;

function headersOf(content: string): string[] {
  const first = content.replace(/^﻿/, '').split(/\r?\n/)[0] ?? '';
  // Quoted cells may hold commas, as learning-ext's CSV reader allows.
  const cells: string[] = []; let cell = '', quoted = false;
  for (let index = 0; index < first.length; index++) {
    const char = first[index]!;
    if (quoted) { if (char === '"' && first[index + 1] === '"') { cell += '"'; index++; } else if (char === '"') quoted = false; else cell += char; }
    else if (char === '"') quoted = true; else if (char === ',') { cells.push(cell); cell = ''; } else cell += char;
  }
  cells.push(cell);
  return cells.map(item => item.trim()).filter(Boolean);
}

/** `learningx.dictionaryBuild` and `learningx.dictionaryProposals`, kept in the fake engine's memory. */
export function learningxProposalHandlers(): Readonly<Record<string, FakeHandler>> {
  const items: Record<string, unknown>[] = [];
  return {
    dictionaryProposals: payload => {
      const limit = typeof payload['limit'] === 'number' ? payload['limit'] : 20;
      return { items: [...items].reverse().slice(0, limit), total: items.length };
    },
    dictionaryBuild: async (payload, context) => {
      if (context.role === 'viewer') throw context.refuse('FORBIDDEN', 'A viewer seat changes nothing.');
      const files = payload['files'];
      const content = Array.isArray(files) && typeof (files[0] as Record<string, unknown> | undefined)?.['content'] === 'string' ? (files[0] as Record<string, string>)['content']! : null;
      if (content === null || headersOf(content).length === 0) throw context.refuse('EMPTY_FILE', 'Each file needs a header row.');
      const headers = headersOf(content);
      const evidence = headers.filter(header => !CORE.has(header.toLowerCase())).map(header => ({
        name: header.replace(/[^A-Za-z0-9]/g, '') || 'field', header, files: [0], filled: 2, rows: 2, reasons: ['synthetic'],
        type: AMOUNT.test(header) ? 'money' : /date|due/i.test(header) ? 'date' : 'string',
        confidence: AMOUNT.test(header) ? 'high' : 'medium', existing: /^(amount|customerId|invoiceId)$/i.test(header),
      }));
      const proposal = {
        id: `dictproposal_fake_${items.length + 1}`, at: `${context.date}T06:00:00.000Z`, memberId: 'member_demo_owner', origin: 'profile',
        pack: { pack: 'retail', confidence: 'medium', scores: { retail: 1 }, matched: [] }, draft: {}, draftDigest: 'a'.repeat(64), evidence,
        skipped: headers.filter(header => CORE.has(header.toLowerCase())).map(header => ({ header, reason: 'record-identity-column' })),
        sourceIds: [], contentHashes: [await sha256Hex(content)], status: 'proposed', cases: [], failing: [], publishedHash: null, baseHash: null, digest: 'b'.repeat(64),
      };
      items.push(proposal);
      return proposal;
    },
  };
}

/**
 * FR-10: `learningx.intakeStatus`, `learningx.preview` and `learningx.consent` in learning-ext's
 * registered shapes (platform/runtime/learning-ext/sharing.ts), kept in memory. `mode` is the
 * intake: `closed` (no intake configured), `test-inbox` (a demo workspace) or `intake`.
 * `sharingSwitch` is the Trust sharing switch. The bytes are structure only.
 */
export function learningxSharingHandlers(options: { readonly mode?: 'closed' | 'intake' | 'test-inbox'; readonly sharingSwitch?: boolean; readonly empty?: boolean } = {}): Readonly<Record<string, FakeHandler>> {
  const mode = options.mode ?? 'closed', sharingSwitch = options.sharingSwitch ?? false;
  const previews = new Map<string, { digest: string; boxes: string[] }>();
  const status = () => ({
    open: mode !== 'closed', mode, sharingSwitch,
    label: mode === 'test-inbox' ? 'Demo test: sends to a test inbox only.' : mode === 'closed' ? 'Sharing is not open yet. Nothing is sent.' : 'Sharing sends structure only.',
    boxes: [{ box: 'setup-shapes', open: true }, { box: 'corrections', open: true }, { box: 'account-words', open: false, shown: false }, { box: 'question-shapes', open: false, shown: false }],
  });
  return {
    intakeStatus: () => status(),
    preview: async (payload, context) => {
      if (context.role !== 'owner' && context.role !== 'cofounder') throw context.refuse('FORBIDDEN', 'Only an owner previews sharing.');
      const boxes = Array.isArray(payload['boxes']) ? (payload['boxes'] as unknown[]).filter((box): box is string => box === 'setup-shapes' || box === 'corrections').sort() : [];
      if (boxes.length === 0) throw context.refuse('INVALID_REQUEST', 'Choose one or more sharing boxes.');
      if (options.empty) throw context.refuse('NOTHING_TO_SHARE', 'No new decisions are waiting in the chosen boxes.');
      const events = boxes.map(box => ({ kind: box === 'corrections' ? 'mapping' : 'mapping', choice: box === 'corrections' ? 'corrected' : 'accepted', field: 'amount', type: 'money' }));
      const bytes = `{"schema":"chausar.learning.v1","boxes":${JSON.stringify(boxes)}}\n${events.map(event => JSON.stringify(event)).join('\n')}\n{"end":true}`;
      const digest = await sha256Hex(bytes);
      const id = `sharepreview_fake_${previews.size + 1}`;
      previews.set(id, { digest, boxes });
      return { id, at: `${context.date}T06:00:00.000Z`, memberId: 'member_demo_owner', epoch: 1, boxes, decisionIds: events.map((_, index) => `decision_${index + 1}`), sourceIds: [], digest, size: bytes.length, count: events.length, blocked: [], bytes, names: 0, amounts: 0, publicName: null, authors: [], status: status() };
    },
    consent: (payload, context) => {
      if (!sharingSwitch) throw context.refuse('SHARING_DISABLED', 'Turn on structure-only sharing before giving consent.');
      const preview = typeof payload['previewId'] === 'string' ? previews.get(payload['previewId']) : undefined;
      if (preview === undefined) throw context.refuse('NOT_FOUND', 'That sharing preview does not exist.');
      if (payload['digest'] !== preview.digest) throw context.refuse('PREVIEW_CHANGED', 'Consent must name the exact previewed bytes.');
      return { id: 'shareconsent_fake_1', at: `${context.date}T06:00:00.000Z`, previewId: payload['previewId'], digest: preview.digest, publicName: null, memberId: 'member_demo_owner', role: context.role, epoch: 1, integrity: 'c'.repeat(64) };
    },
  };
}

/* --------------------------------------------------------------------------- FR-10 sharing */

/** learning-ext `vocabulary.ts`: the four boxes; the last two wait for the founder switch. */
export const SHARING_BOXES = ['setup-shapes', 'corrections', 'account-words', 'question-shapes'] as const;
export const OPEN_SHARING_BOXES = ['setup-shapes', 'corrections'] as const;
const LEARNING_SCHEMA = 'chausar.learning.v1';

/** Synthetic decisions from the log, each one structure-only event (vocabulary tokens only). */
const DECISIONS: readonly { readonly id: string; readonly box: string; readonly event: Readonly<Record<string, unknown>> }[] = [
  { id: 'decision_fake_1', box: 'setup-shapes', event: { kind: 'mapping', choice: 'accepted', reason: 'manual-confirmation', system: 'spreadsheet', shape: 'invoice', fields: [['amount', 'decimal'], ['date', 'date'], ['invoice-id', 'string']] } },
  { id: 'decision_fake_2', box: 'setup-shapes', event: { kind: 'identity', choice: 'accepted', reason: 'type-match', system: 'spreadsheet' } },
  { id: 'decision_fake_3', box: 'corrections', event: { kind: 'mapping', choice: 'corrected', reason: 'ambiguous-field', system: 'spreadsheet', shape: 'invoice', fields: [['customer-id', 'string']] } },
];

/** learning-ext's canonical JSON: keys sorted, no spaces. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** `structure.ts` batchBytes: a fixed first line, one event per line, a fixed last line. */
function batchBytes(boxes: readonly string[], events: readonly unknown[]): string {
  return [`{"schema":${JSON.stringify(LEARNING_SCHEMA)},"boxes":${canonical(boxes)},"events":[`,
    ...events.map((event, index) => `${canonical(event)}${index < events.length - 1 ? ',' : ''}`), ']}'].join('\n');
}

export interface SharingHost {
  /** A demo workspace sends to a local test inbox; any other is closed (no intake configured). */
  demo(): boolean;
  /** Core `learning.sharing`: the structure-only sharing switch. */
  sharing(): boolean;
}

/** The fake engine's default `learningx.intakeStatus`, `preview`, `consent` and `submit`, kept in its memory.
 *  A test that wants a set intake registers `learningxSharingHandlers` instead. */
export function learningxSharingDefaults(host: SharingHost): Readonly<Record<string, FakeHandler>> {
  const previews = new Map<string, { boxes: string[]; decisionIds: string[]; digest: string }>();
  const consents = new Map<string, { previewId: string; digest: string; used: boolean }>();
  const sent = new Set<string>();
  let serial = 0;
  const admin = (role: string, refuse: (code: string, message?: string) => Error) => { if (role !== 'owner' && role !== 'cofounder') throw refuse('FORBIDDEN', 'An owner must approve this change.'); };
  const status = () => {
    const mode = host.demo() ? 'test-inbox' : 'closed';
    return {
      open: mode !== 'closed', mode, sharingSwitch: host.sharing(),
      label: mode === 'test-inbox' ? 'Demo test: sends to a test inbox only.' : 'Sharing is not open yet. Nothing is sent.',
      boxes: SHARING_BOXES.map(box => ((OPEN_SHARING_BOXES as readonly string[]).includes(box) ? { box, open: true } : { box, open: false, reason: 'Waits for the founder switch and a reviewed consent text.', shown: false })),
    };
  };
  return {
    'learningx.intakeStatus': () => status(),
    'learningx.preview': async (payload, context) => {
      admin(context.role, context.refuse);
      const asked = payload['boxes'] ?? [...OPEN_SHARING_BOXES];
      if (!Array.isArray(asked) || asked.length === 0 || asked.length > SHARING_BOXES.length || !asked.every(box => (SHARING_BOXES as readonly unknown[]).includes(box))) throw context.refuse('INVALID_REQUEST', 'Choose one or more sharing boxes.');
      const boxes = [...new Set(asked as string[])].sort();
      if (!boxes.every(box => (OPEN_SHARING_BOXES as readonly string[]).includes(box))) throw context.refuse('BOX_NOT_OPEN', 'This box waits for the founder switch and a reviewed consent text. Nothing is sent.');
      const chosen = DECISIONS.filter(item => boxes.includes(item.box) && !sent.has(item.id)).map(item => ({ item, key: canonical(item.event) }))
        .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : a.item.id < b.item.id ? -1 : 1).map(entry => entry.item);
      if (chosen.length === 0) throw context.refuse('NOTHING_TO_SHARE', 'No new decisions are waiting in the chosen boxes.');
      const bytes = batchBytes(boxes, chosen.map(item => item.event));
      const id = `sharepreview_fake_${++serial}`, digest = await sha256Hex(bytes);
      previews.set(id, { boxes, decisionIds: chosen.map(item => item.id), digest });
      return { id, at: `${context.date}T06:00:00.000Z`, memberId: 'member_demo_owner', epoch: 1, boxes, decisionIds: chosen.map(item => item.id), sourceIds: [],
        digest, size: new TextEncoder().encode(bytes).length, count: chosen.length, blocked: [], bytes, names: 0, amounts: 0, publicName: null,
        authors: [{ memberId: 'member_demo_owner', count: chosen.length }], status: status() };
    },
    'learningx.consent': (payload, context) => {
      admin(context.role, context.refuse);
      if (!host.sharing()) throw context.refuse('SHARING_DISABLED', 'Turn on structure-only sharing before giving consent.');
      const preview = typeof payload['previewId'] === 'string' ? previews.get(payload['previewId']) : undefined;
      if (preview === undefined) throw context.refuse('NOT_FOUND', 'That sharing preview does not exist.');
      if (payload['digest'] !== preview.digest) throw context.refuse('PREVIEW_CHANGED', 'Consent must name the exact previewed bytes.');
      const id = `shareconsent_fake_${++serial}`;
      consents.set(id, { previewId: payload['previewId'] as string, digest: preview.digest, used: false });
      return { id, at: `${context.date}T06:00:00.000Z`, previewId: payload['previewId'], digest: preview.digest, publicName: null, memberId: 'member_demo_owner', role: context.role, epoch: 1, integrity: 'c'.repeat(64) };
    },
    'learningx.submit': (payload, context) => {
      admin(context.role, context.refuse);
      if (!host.sharing()) throw context.refuse('SHARING_DISABLED', 'Turn on structure-only sharing first.');
      const consent = typeof payload['consentId'] === 'string' ? consents.get(payload['consentId']) : undefined;
      if (consent === undefined) throw context.refuse('CONSENT_REQUIRED', 'Give consent to the exact preview first.');
      if (consent.used) throw context.refuse('BATCH_ALREADY_ATTEMPTED', 'This consent was already used.');
      if (!host.demo()) throw context.refuse('INTAKE_NOT_OPEN', 'Sharing is not open yet. Nothing is sent.');
      const preview = previews.get(consent.previewId)!;
      consent.used = true;
      for (const id of preview.decisionIds) sent.add(id);
      const id = `sharebatch_fake_${++serial}`;
      const bytes = batchBytes(preview.boxes, preview.decisionIds.map(decision => DECISIONS.find(item => item.id === decision)!.event));
      return { id, at: `${context.date}T06:00:00.000Z`, consentId: payload['consentId'], previewId: consent.previewId, mode: 'test-inbox', boxes: preview.boxes, decisionIds: preview.decisionIds,
        bytes, digest: preview.digest, size: new TextEncoder().encode(bytes).length, count: preview.decisionIds.length,
        status: 'sent', reference: `test-inbox:${id}`, settledAt: `${context.date}T06:00:00.000Z` };
    },
  };
}

/** What the fake engine serves for `learningx` when no test registered its own handlers. */
export function learningxFakeHandlers(host: SharingHost): Readonly<Record<string, FakeHandler>> {
  const proposals = learningxProposalHandlers();
  return {
    'learningx.dictionaryProposals': proposals['dictionaryProposals']!,
    'learningx.dictionaryBuild': proposals['dictionaryBuild']!,
    ...learningxSharingDefaults(host),
  };
}
