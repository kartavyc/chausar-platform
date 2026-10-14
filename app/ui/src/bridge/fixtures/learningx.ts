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
