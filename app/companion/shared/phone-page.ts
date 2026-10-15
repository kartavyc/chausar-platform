import type { ApprovalListItem } from '../../../platform/runtime/phone/contracts.ts';
import type { CompanionViewState } from './view-contracts.ts';

/**
 * PH-04 "The phone page" — EXPERIMENTAL. Off unless a host passes
 * `experiments: { phonePage: true }` to the controller. The founder decides whether
 * it ships. Headlines only: figures, summaries and receipts stay on the computer.
 */
export type PhonePageExperiments = { phonePage?: boolean };

/** Raw page data the controller keeps. Brief summaries are never stored here. */
export type PhonePageState = {
  /** undefined until loaded; 'saved' once the connection is lost (read only). */
  review?: { items: ApprovalListItem[]; freshness: 'current' | 'saved' };
  /** approval.list was refused (no approvals port, or no approval capability). */
  reviewUnavailable: boolean;
  headlines: { title: string; generatedAt: string }[];
  /** Engine-stamped time of the last successful session.validate; never guessed. */
  lastSeenAt?: string;
  /** Set after a fresh approval.inspect; the single-use token stays inside PhoneClient. */
  confirm?: { approvalId: string; title: string; expiresAt: string };
};
export const emptyPhonePage = (): PhonePageState => ({ reviewUnavailable: false, headlines: [] });

/** Fixed words. No digits; a Hindi catalogue can be added with the same keys. */
export const phonePageWords = {
  en: {
    title: 'The phone page',
    experimental: 'Experimental. Not switched on for everyone; the founder decides whether it ships.',
    awaiting: 'Awaiting your review',
    approve: 'Approve',
    inTheApp: 'In the app',
    confirmQuestion: 'Approve this one small change?',
    confirmHelp: 'It stays inside your workspace and can be undone in the app.',
    confirmApprove: 'Approve',
    notNow: 'Not now',
    nothingAwaiting: 'Nothing is awaiting your review.',
    reviewNotLoaded: 'Refresh while connected to see what awaits you.',
    reviewUnavailable: 'Your review list is in the app on your computer.',
    weekAhead: 'The week ahead',
    weekAheadEmpty: 'The week ahead is not ready yet.',
    figureHeadline: 'A headline with figures. Read it on your computer.',
    figureTitle: 'A change with figures. See it in the app.',
    laptopSeen: 'Laptop last seen',
    notKnown: 'Not known',
    refresh: 'Refresh',
    savedReadOnly: 'Saved view. Read only until you reconnect; nothing can be approved.',
    rule: 'Headlines only. Figures and receipts stay on the computer.',
    approved: 'Approved. The app shows the result.',
    decidedInApp: 'This one is decided in the app.',
  },
} as const;
export type PhonePageWords = typeof phonePageWords.en;

/** Any decimal digit in any script means the text carries a figure. */
const hasDigit = (text: string) => /\p{Nd}/u.test(text);
const figureFree = (text: string, fallback: string) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return !clean || hasDigit(clean) ? fallback : clean;
};
export function headlineText(title: string, words: PhonePageWords = phonePageWords.en): string {
  return figureFree(title, words.figureHeadline);
}
/** An approval row or confirm title, under the same digit check: "Pay ₹4,500" never reaches the page. */
export function approvalTitleText(title: string, words: PhonePageWords = phonePageWords.en): string {
  return figureFree(title, words.figureTitle);
}

export type PhonePageRow = { approvalId: string; title: string; action: 'approve' | 'in-the-app' };
export type PhonePageView = {
  experimental: true;
  readOnly: boolean;
  review: { status: 'not-loaded' | 'unavailable' | 'loaded'; count?: number; rows: PhonePageRow[]; saved: boolean };
  weekAhead: string[];
  lastSeen: { known: false } | { known: true; at: string };
  confirm?: { approvalId: string; title: string; expiresAt: string; expired: boolean };
};

function onlineAuthority(state: CompanionViewState, now: number) {
  const pairing = state.client.pairing;
  return state.client.connection === 'online' && pairing.status === 'paired' && Date.parse(pairing.authority.expiresAt) > now
    ? pairing.authority : undefined;
}

/** Pure display model shared by the web and native screens. */
export function phonePageView(state: CompanionViewState, now: number): PhonePageView | undefined {
  const page = state.phonePage; if (!page) return undefined;
  const authority = onlineAuthority(state, now);
  const readOnly = !authority || !authority.capabilities.includes('approval.simple');
  const review = page.review;
  const saved = !review || review.freshness === 'saved';
  const rows = (review?.items ?? []).map(item => ({ approvalId: item.approvalId, title: approvalTitleText(item.title),
    action: !readOnly && !saved && item.eligibility === 'simple-reversible' ? 'approve' as const : 'in-the-app' as const }));
  const weekAhead = [...page.headlines]
    .sort((left, right) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt))
    .slice(0, 3).map(headline => headlineText(headline.title));
  const seen = page.lastSeenAt && Number.isFinite(Date.parse(page.lastSeenAt)) && Date.parse(page.lastSeenAt) <= now ? page.lastSeenAt : undefined;
  const confirm = page.confirm && !readOnly
    ? { ...page.confirm, title: approvalTitleText(page.confirm.title), expired: !(Date.parse(page.confirm.expiresAt) > now) } : undefined;
  return {
    experimental: true, readOnly,
    review: page.reviewUnavailable ? { status: 'unavailable', rows: [], saved }
      : review ? { status: 'loaded', count: review.items.length, rows, saved } : { status: 'not-loaded', rows: [], saved },
    weekAhead,
    lastSeen: seen ? { known: true, at: seen } : { known: false },
    ...(confirm ? { confirm } : {}),
  };
}
