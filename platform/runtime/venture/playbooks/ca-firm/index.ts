// Chausar flagship playbook: the AI-native CA firm (design 7.8). One place to import it from.
// Data: offers, typed steps, agent roles, approvals, connectors, hard lines and the CA's duties (playbook.ts); the
// versioned rate tables with citations and the open questions (rates.ts). Deterministic engines in BigInt paise:
// income tax (income-tax.ts), interest under 234A, 234B and 234C (interest.ts), the GST working (gst.ts), the TDS
// working (tds.ts), reconciliation and the month close (reconcile.ts), the final diff against the portal's own file
// (portal.ts). Claim checks, judge rules and the committed baseline for drafts (claims.ts, baseline.json). The CA of
// record, rate-table confirmations and recorded sign-offs, which feed Today's queue (signoff.ts).
export * from './registration.ts';
export * from './money.ts';
export * from './rates.ts';
export * from './receipt.ts';
export * from './income-tax.ts';
export * from './interest.ts';
export * from './gst.ts';
export * from './tds.ts';
export * from './reconcile.ts';
export * from './portal.ts';
export * from './playbook.ts';
export * from './claims.ts';
export * from './signoff.ts';
