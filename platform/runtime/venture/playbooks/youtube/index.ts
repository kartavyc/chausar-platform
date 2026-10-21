// Chausar flagship playbook: the YouTube channel (design 7.8). One place to import it from.
// Data: offers, ten typed steps with roles, approvals, the floor, intake and connectors (playbook.ts); the dated register
// of platform rules with sources (platform-rules.ts). Deterministic checks with no model: hooks, title and thumbnail,
// metadata limits, chapters, retention risks, disclosure, rights and source credit (checks.ts, transcript.ts). The
// finishing check on a cut through ffmpeg when it is on this computer (finishing.ts). Judge rules and the committed
// baseline (judge.ts, baselines/youtube.json).
export * from './registration.ts';
export * from './platform-rules.ts';
export * from './playbook.ts';
export * from './transcript.ts';
export * from './checks.ts';
export * from './finishing.ts';
export * from './judge.ts';
