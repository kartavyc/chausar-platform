// Test helper, not a test file: the delivery drafts posts come from (catalogue H6). A post names a draft by id; its text
// is that draft's line for the channel ("X: Fresh pastries at 8."). Records are put the way the delivery and share
// packages store them, so the posting gate reads real shapes.
import type { Context } from '../runtime/contracts.ts';
import type { DeliveryRunRecord, PlaybookRecord, ShareLinkStoredRecord, VentureDeps } from '../runtime/venture/contracts.ts';
import { digest, ventureAction } from '../runtime/venture/records.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };

/** A stored playbook; a flagship playbook's when flagship is given (for example 'social-agency'). */
export async function seedPostPlaybook(deps: VentureDeps, flagship: string | null = null): Promise<PlaybookRecord> {
  return ventureAction(deps, owner, 'prepare', 'seed.playbook', tx => tx.put<PlaybookRecord>({
    ...tx.base('venture-playbook'), version: 1, hash: 'hash', blueprintDigest: 'blueprint', serviceType: 'agency', steps: [], validated: true,
    tierCeiling: 'code', ...(flagship ? { flagship } : {}),
  }));
}

/** A model draft the owner accepted, with every check passed, holding the given lines under one heading. */
export async function seedPostDraft(deps: VentureDeps, lines: string[], fields: Partial<DeliveryRunRecord> = {}): Promise<DeliveryRunRecord> {
  return ventureAction(deps, owner, 'prepare', 'seed.draft', tx => tx.put<DeliveryRunRecord>({
    ...tx.base('venture-delivery-run'), orderId: 'order_none', playbookId: 'playbook_none', playbookHash: 'hash', status: 'accepted', servedBy: 'model',
    practice: false, callId: null, preview: null,
    deliverable: { title: 'Posts for October', sections: [{ heading: 'Posts', parts: lines.map(text => ({ kind: 'text' as const, text })) }], questionsForClient: [] },
    renderedText: `# Posts for October\n\n## Posts\n${lines.join('\n')}`, checks: [{ check: 'house-style', passed: true, detail: 'No long dash and no avoided words.' }],
    verdict: { choice: 'accepted', reason: null, at: tx.now }, editedText: null, ...fields,
  }));
}

/** The text the client approves and posts come from: the owner's edit, else the rendered draft (as build/share-links.ts). */
export function draftText(run: DeliveryRunRecord): string {
  return run.status === 'edited' && run.editedText ? run.editedText : run.renderedText ?? '';
}

/** The digest a client's answer is bound to: the share link's, over the draft id, its title and its text. */
export function clientDigest(run: DeliveryRunRecord): string {
  return digest({ deliveryId: run.id, title: run.deliverable?.title ?? 'Draft', text: draftText(run) });
}

/** The client's answer on a draft, kept on a share link record as the share package keeps it. */
export async function seedClientAnswer(deps: VentureDeps, run: DeliveryRunRecord, decision: 'approved' | 'changes', draftDigest = clientDigest(run)): Promise<ShareLinkStoredRecord> {
  return ventureAction(deps, owner, 'approve', 'seed.share', tx => tx.put<ShareLinkStoredRecord>({
    ...tx.base('venture-share-link'), deliveryId: run.id, clientId: null, tokenHash: 'a'.repeat(64), title: run.deliverable?.title ?? 'Draft',
    text: draftText(run), draftDigest, expiresAt: '2026-12-31T00:00:00.000Z', state: 'closed', revokedAt: null, served: false,
    decisions: [{ draftId: run.id, decision, comment: null, at: tx.now, digest: draftDigest, via: 'owner-recorded', recordedBy: 'owner' }],
  }));
}
