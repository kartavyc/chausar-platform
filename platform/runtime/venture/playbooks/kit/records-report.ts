// Chausar playbook kit: client reports and their share links (Ink v2 wave 5, package 5A5, P11). The record bodies and
// the methods' answers; types only (contracts.ts imports them). Written for Chausar; nothing here is learned from an
// outside source.
import type { Display, IsoDate, IsoTime } from '../../contracts.ts';

/** The files a report can be made as. */
export type ReportFormat = 'html' | 'pdf' | 'docx' | 'xlsx';

/**
 * Where a block belongs, for a share link's scope: the channel it is about (a platform's export, 'instagram') and the
 * days it covers. null: it is about no one channel, or no dates; such a block is never outside a scope.
 */
export type BlockScope = { channel: string | null; from: IsoDate | null; to: IsoDate | null };
/** One bar of a bars block, as code worked it out from its receipt; width is its share of the longest bar, 0 to 100. */
export type ReportBar = { label: string; display: string; receiptId: string; key: string; width: number };
/**
 * A report block after its sources were checked (playbooks/kit/report/blocks.ts). A metric's and every bar's figure
 * is a receipt's own figure; a heading or prose that holds a number (digits, or a number in Hindi or English words)
 * the owner did not write is a model estimate; a quote is shown as written.
 */
export type ReportBlock =
  | { kind: 'heading'; text: string; estimate: boolean }
  | ({ kind: 'prose'; text: string; estimate: boolean } & BlockScope)
  | ({ kind: 'metric'; label: string; display: string; unit: string; receiptId: string; key: string } & BlockScope)
  | ({ kind: 'bars'; label: string; bars: ReportBar[] } & BlockScope)
  | { kind: 'quote'; text: string; by: string | null };

/**
 * One file of a report as render made it: its name, format, size, sha256 and bytes. The vault keeps only what
 * ReportFileMeta holds: the bytes go to the screen once; a later save makes the report again (render is code, apart
 * from the PDF's own bytes).
 */
export type ReportFile = { name: string; format: ReportFormat; bytes: number; sha256: string; contentBase64: string };
export type ReportFileMeta = Omit<ReportFile, 'contentBase64'>;
/** The manifest beside the files: manifest.json, listing each file's name, size and sha256. */
export type ReportManifestFile = { name: 'manifest.json'; bytes: number; sha256: string; contentBase64: string };
export type ReportManifestMeta = Omit<ReportManifestFile, 'contentBase64'>;

/**
 * venture-report: one rendered report of a run's draft. draftDigest is the draft as it was rendered (a share refuses
 * once it changed); notes say what was not made and why (no PDF on hosted, Hindi the PDF could not draw).
 */
export type ReportBody = {
  runId: string;
  orderId: string;
  clientId: string | null;
  title: string;
  /** The title holds a number the owner did not write: shown as a model estimate. */
  titleEstimate: boolean;
  draftDigest: string;
  formats: ReportFormat[];
  blocks: ReportBlock[];
  receiptIds: string[];
  channels: string[];
  period: { from: IsoDate; to: IsoDate } | null;
  files: ReportFileMeta[];
  manifest: ReportManifestMeta;
  notes: Display[];
};

/**
 * venture-report-share: one report's share link, scoped to a date range and channels. The vault keeps a sha256 of
 * the token, never the token. Rotate swaps the token (the old one ends); disable stops it. views counts each time the
 * page was opened through the token (never with a pixel; the owner's own look does not count).
 */
export type ReportShareBody = {
  reportId: string;
  tokenHash: string;
  from: IsoDate;
  to: IsoDate;
  channels: string[];
  state: 'open' | 'disabled';
  served: boolean;
  expiresAt: IsoTime;
  views: number;
  viewedAt: IsoTime | null;
  rotatedAt: IsoTime | null;
  disabledAt: IsoTime | null;
};

/** What a print port prints (playbooks/kit/report/pdf.ts): one HTML file, and the scripts its words use. */
export type PrintRequest = { html: string; scripts: ('latin' | 'devanagari')[] };
/** The port's answer: the PDF's bytes, or why there is none ('font-missing': no font here draws a script it needs). */
export type PrintResult = { ok: true; pdfBase64: string } | { ok: false; reason: 'font-missing' | 'failed' };
/** The desktop's printer (Electron's printToPDF, app/desktop/report-print.cjs). Trusted host composition only. */
export type PrintPort = { print(request: PrintRequest): Promise<PrintResult> };

/** venture.report.render's answer: the report with every file's bytes, for the screen to offer as downloads. */
export type ReportView = {
  id: string;
  runId: string;
  title: string;
  formats: ReportFormat[];
  files: ReportFile[];
  manifest: ReportManifestFile;
  notes: Display[];
  channels: string[];
  period: { from: IsoDate; to: IsoDate } | null;
  /** How many prose blocks hold a number no receipt backs, shown as model estimates. */
  estimates: number;
};

/**
 * venture.report.share's, .shareRotate's and .shareDisable's answer. url only once, right after share or rotate,
 * and only on the hosted Chausar with a public address; reason says why there is none.
 */
export type ReportShareView = {
  id: string;
  reportId: string;
  url: string | null;
  reason?: Display;
  from: IsoDate;
  to: IsoDate;
  channels: string[];
  state: 'open' | 'disabled' | 'ended';
  expiresAt: IsoTime;
  views: number;
  viewedAt: IsoTime | null;
};

/**
 * One report as venture.report.list shows it: what render made (no bytes; save makes the report again), and every
 * share link to it with its state, views and end date. Never an address or a token.
 */
export type ReportListItem = {
  id: string; runId: string; orderId: string; title: string; at: IsoTime; formats: ReportFormat[]; files: ReportFileMeta[];
  manifest: ReportManifestMeta; notes: Display[]; channels: string[]; period: { from: IsoDate; to: IsoDate } | null;
  estimates: number; links: ReportShareView[];
};
/** venture.report.list's answer: newest report first. */
export type ReportListView = { reports: ReportListItem[] };
