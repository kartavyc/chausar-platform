// Chausar flagship playbook: the social agency's wave 5 records (Ink v2 wave 5, packages 5D2 and 5D3). Package 5-0
// named each body as a placeholder; the package replaces it here, never in contracts.ts. Types only. Written for
// Chausar; nothing here is learned from an outside source.

/** venture-social-inbox-item: one comment or message in the reply inbox, a placeholder until 5D2 lands. */
export type SocialInboxItemBody = import('./inbox.ts').InboxItem;
/** venture-ad-ledger-entry: one competitor ad the owner captured, a placeholder until 5D2 lands. */
export type AdLedgerEntryBody = { orderId: string; capturedBy: 'owner'; status: 'live'|'stopped'; format: 'video'|'image'|'carousel'; source: string; capturedAt: string };
/** venture-influencer-case: one influencer campaign case, a placeholder until 5D3 lands. */
export type InfluencerCaseBody = { placeholder: true };
