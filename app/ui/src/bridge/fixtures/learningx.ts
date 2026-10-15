/**
 * Synthetic learning-ext dictionary proposals for previews and tests. The fake engine does not
 * serve the `learningx` family itself (another lane owns it); register these with
 * `registerFakeMethods('learningx', learningxProposalHandlers())` to draw FR-07's
 * "Proposed meanings (draft)". Without them the list says "not built yet".
 *
 * The draft is the shape of `learningx.dictionaryBuild`: header names and inferred kinds only,
 * never cell values. Only previews and tests import this.
 */
import type { FakeHandler } from '../fake.ts';
import { sha256Hex } from './shop.ts';

const CORE = new Set(['id', 'kind', 'type', 'date', 'branch']);
const AMOUNT = /(amount|price|total|value|cost|fee|tax|paid)/i;

function headersOf(content: string): string[] {
  const first = content.replace(/^﻿/, '').split(/\r?\n/)[0] ?? '';
  return first.split(',').map(cell => cell.trim().replace(/^"|"$/g, '')).filter(Boolean);
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
