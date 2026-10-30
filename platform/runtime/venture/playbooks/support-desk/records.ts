// Support records, independently written from nexusdesk (Apache-2.0) and ResolveHQ ideas (source-available, no copied code).
import type {ShopCustomerMatch} from './match.ts';
export type TicketStatus = 'open' | 'in-progress' | 'waiting-customer' | 'resolved' | 'closed';
export type SupportDraft = { original: string; translated: string; language: string; sources: string[]; approved: boolean; policyChange: boolean; sourceFiles?: {id:string;digest:string}[] };
export type SupportTicketBody = {
  replyAddress?:string; customerMatch?:ShopCustomerMatch; customerOrderNumber?:string; customerPhone?:string; serviceOrderId?: string | null; shopClientId?: string | null; policyApproval?: {shareId:string;replyDigest:string} | null; number?: string; rating?: { tokenHash: string; expiresAt: string }; proposal?: { expiresAt: string } | null; thread: string; customerEmail: string; subject: string; language: string; blocked: boolean;
  status: TicketStatus; revision: number; note: string; autoDraftsPaused: boolean;
  dueAt: string | null; resolutionDueAt: string | null; snoozedAt: string | null; snoozeUntil: string | null; snoozeReason: string | null;
  draft: SupportDraft | null; sentAt: string | null; messages: SupportMessageBody[]; policyChangeApproved: boolean;
};
export type SupportMessageBody = { ticketId: string; messageId: string | null; sender: string; text: string; at: string; messageKind: 'customer' | 'owner' | 'system'; references: string[]; untrusted: boolean };
export type SupportRequestBody = { ticketId: string; requestKind: 'refund' | 'replacement'; amountText: string; currency: string; state: 'requested, not done' };
export type SupportRatingBody = { ticketId: string; score: number; at: string };
