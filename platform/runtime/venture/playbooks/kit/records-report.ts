// Chausar playbook kit: client reports and their share links (Ink v2 wave 5, package 5A5). Package 5-0 named the record
// bodies and the methods' shapes as placeholders; 5A5 replaces them here, never in contracts.ts. Types only. Written
// for Chausar; nothing here is learned from an outside source.

/** The files a report can be made as. */
export type ReportFormat = 'html' | 'pdf' | 'docx' | 'xlsx';
/** venture-report: one rendered report and its manifest, a placeholder until 5A5 lands. */
export type ReportBody = { placeholder: true };
/** venture-report-share: one report's share link, a placeholder until 5A5 lands. */
export type ReportShareBody = { placeholder: true };
/** venture.report.render's answer. */
export type ReportView = { placeholder: true };
/** venture.report.share's, .shareRotate's and .shareDisable's answer. */
export type ReportShareView = { placeholder: true };
