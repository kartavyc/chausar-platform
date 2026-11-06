// Chausar S12 exact single-slot approval shapes. Original browser-safe data model.
export type ScheduledPostBinding = {
    slotId: string;
    dueAt: string;
    deadlineAt: string;
    filesDigest: string;
};
export type SocialScheduledBody = {
    postId: string | null;
    connectorId: string;
    text: string;
    account: string | null;
    mode: string | null;
    dueAt: string;
    deadlineAt: string;
    postDigest: string | null;
    filesDigest: string | null;
    approvedDigest: string | null;
    approvedAt: string | null;
    approvedBy: string | null;
    nothingReadyAt: string | null;
    state: 'draft' | 'scheduled' | 'waiting' | 'posted' | 'missed' | 'blocked' | 'unknown' | 'cancelled';
    reason: string;
};
export type SocialScheduledItem = SocialScheduledBody & {
    id: string;
};
export const SLOT_GRACE_MS = 60 * 60000;
export const SCHEDULED_WORDS = { forgotten: 'This slot was cancelled because it named someone you asked Chausar to forget.', draft: 'Review this exact post and time before approving the slot.', empty: 'There is nothing ready for this slot. No post was sent.', busy: 'Another post is going out. This slot will wait for up to sixty minutes.', missed: 'This slot was missed because no post went out within sixty minutes.', restart: 'This posting approval is no longer in this session. Review and approve a new slot again.', changed: 'The post or its source files changed since review. Review and approve a new slot.', cancelled: 'You cancelled this slot. No new post will start.', scheduled: 'This exact slot is approved. Keep this desktop business open until it runs.' } as const;
export const slotApprovalPart = (slot: SocialScheduledItem) => ({ id: slot.id, postId: slot.postId, connectorId: slot.connectorId, text: slot.text, account: slot.account, mode: slot.mode, dueAt: slot.dueAt, deadlineAt: slot.deadlineAt, postDigest: slot.postDigest, filesDigest: slot.filesDigest });
// Internal fake posting bridge. No caller payload can provide these trusted post facts.
export type ScheduledPostSnapshot = {
    id: string;
    connectorId: string;
    draftId: string;
    text: string;
    account: string | null;
    mode: string;
    digest: string;
    filesDigest: string;
    state: 'described' | 'approved' | 'rejected' | 'applied' | 'outcome_unknown';
    liveAccount?: string | null;
    claimedAt?: string | null;
    blocked?: {code:string;line:string} | null;
    scheduled: boolean;
};
