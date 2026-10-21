// Chausar flagship playbook: the social media agency (design 7.8). One place to import it from.
// Data: offers, fourteen typed steps with agent roles, approvals, connectors and the never list (playbook.ts); the
// channel capability table (channels.ts); the dated register of platform rules with sources (register.ts).
// Deterministic checks with no model: channel limits, claims against proof files, disclosure, banned words and thread
// splitting (checks.ts); calendar slots by code (calendar.ts); owner-then-client approvals, the share link record and
// draft-before-schedule (approvals.ts); the monthly report from client-uploaded exports with receipts (report.ts).
// Judge rules and the committed baseline (judge.ts, baselines/social-agency.json).
export * from './registration.ts';
export * from './register.ts';
export * from './channels.ts';
export * from './checks.ts';
export * from './calendar.ts';
export * from './approvals.ts';
export * from './playbook.ts';
export * from './report.ts';
export * from './judge.ts';
