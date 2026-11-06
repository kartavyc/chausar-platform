// Canonical browser-safe types, shared by the engine and renderer.


export type AuditFinding={package:string;severity:'critical'|'high'|'moderate'|'low'|'info';range:string;advisories:{title:string;url:string}[]};
