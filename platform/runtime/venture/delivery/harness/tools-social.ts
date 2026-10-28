// Chausar delivery harness: the social media agency's report figures as an agent tool (Ink v2 wave 2, package 2F1).
// Code works out posts, views, reach or impressions, follows, engagements, the engagement rate and the top post from
// the platforms' own exports the client uploaded (playbooks/social/report.ts), each with its formula and the file,
// rows and columns it read; the agent only names the month, the files and their platforms, and never types a figure.
// The figures come back as one work receipt the report cites by reference (w1.reach and so on), with every figure's
// source kept under report. Unknown is never zero: a broken cell stops the figure that needs it and the result says
// which. Only the social agency playbook's agents may hold it (patches.ts FLAGSHIP_TOOLS). It reads the client's files
// and writes nothing outside Chausar (policy/effects.ts declares it read); its proof is the totals it worked out.
import type { ToolName, WorkFigure, WorkStep } from '../../contracts.ts';
import { digest } from '../../records.ts';
import { monthlyReport, type ExportPlatform, type ReportReceipt } from '../../playbooks/social/report.ts';
import type { WorkReceiptDraft } from './work.ts';
import { fail, fileOf, receiptOut, text, type Spec, type ToolEnv } from './tools.ts';
import { notBuiltTool } from './tool-stub.ts';
import { SOCIAL_CONTENT_TOOLS } from './tools-social-content.ts';
import { SOCIAL_PRODUCTION_TOOLS } from './tools-social-production.ts';

type SocialToolName = Extract<ToolName, 'social.report'>;

const PLATFORMS: readonly ExportPlatform[] = Object.freeze(['instagram', 'linkedin']);
const PLATFORM_NAMES: Readonly<Record<ExportPlatform, string>> = Object.freeze({ instagram: 'Instagram', linkedin: 'LinkedIn' });
/** Most exports one call reads: one per platform. */
const MAX_EXPORTS = PLATFORMS.length;

/**
 * One report figure as a work figure. With exports of more than one platform, the key and label name the platform
 * (instagram-reach, "Instagram reach"), so no two figures share a ref. A rate keeps hundredths of a percent in minor;
 * a post keeps '0' in minor and its id as the display.
 */
function workFigure(env: ToolEnv, receipt: ReportReceipt, multi: boolean): WorkFigure {
  const key = multi ? `${receipt.platform}-${receipt.key}` : receipt.key;
  const label = multi ? `${PLATFORM_NAMES[receipt.platform]} ${receipt.label.charAt(0).toLowerCase()}${receipt.label.slice(1)}` : receipt.label;
  if (receipt.unit === 'percent') return { key, label, minor: String(BigInt(receipt.value.replace('.', ''))), display: receipt.display, currency: env.currency, unit: 'percent' };
  if (receipt.unit === 'post') return { key, label, minor: '0', display: receipt.value, currency: env.currency, unit: 'post' };
  return { key, label, minor: receipt.value, display: receipt.display, currency: env.currency, unit: 'count' };
}

/** How code got each figure: the columns of the file it read, the rate's two parts, and the formula. */
function workStep(receipt: ReportReceipt, figure: WorkFigure): WorkStep {
  const op: WorkStep['op'] = receipt.key === 'posts' ? 'count' : receipt.key === 'engagement-rate' || receipt.key === 'top-post' ? 'compare' : 'add';
  const inputs = [
    ...receipt.inputs.columns.map(column => `${receipt.inputs.fileName}: ${column}`),
    ...(receipt.numerator !== undefined ? [`numerator ${receipt.numerator}`] : []),
    ...(receipt.denominator !== undefined ? [`denominator ${receipt.denominator}`] : []),
  ];
  return { op, inputs, result: `${figure.label}: ${figure.display}`, rule: receipt.formula };
}

/**
 * The numbers a receipt's own words may hold: each figure's display, with and without grouping, and a count's exact
 * value. A rate's hundredths and a post's zero are storage, never a number the report states, so they are left out.
 */
function allowedNumbers(figures: readonly WorkFigure[]): string[] {
  const numbers = new Set<string>();
  for (const figure of figures) {
    if (figure.unit === 'count') numbers.add(figure.minor);
    numbers.add(figure.display);
    numbers.add(figure.display.replace(/[,%]/g, ''));
  }
  return [...numbers];
}

const socialReport: Spec = {
  name: 'social.report', effect: 'compute', tier: 'code', endsTurn: false,
  summary: "Works out a month's report figures (posts, views, reach or impressions, follows, engagements, the engagement rate and the top post) from the client's platform exports, by code. Returns a receipt with figure refs.",
  input: {
    month: text('The month the report covers, like 2026-11.', 7),
    files: {
      type: 'list', required: true, max: MAX_EXPORTS, about: "The client's exports, one per platform.",
      item: {
        type: 'object', required: true, about: 'One export the client uploaded.', fields: {
          file: text('The export file, such as f1.', 12),
          platform: { type: 'enum', required: true, values: PLATFORMS, about: 'instagram for a content export, linkedin for an updates export.' },
        },
      },
    },
  },
  async run(env, input) {
    const entries = (input.files as { file: string; platform: ExportPlatform }[]).map(entry => ({ ...entry, upload: fileOf(env, entry.file) }));
    if (new Set(entries.map(entry => entry.platform)).size !== entries.length) fail('Give one export for each platform: each platform is worked out once for the month.');
    if (new Set(entries.map(entry => entry.upload.id)).size !== entries.length) fail('Give each export once.');
    for (const entry of entries) if (entry.upload.format !== 'csv') fail(`${entry.file} is not a CSV file. Ask your client for the platform's own CSV export.`);
    // The engine's own refusals (a file of another shape, a post twice, a month it can't read) reach the agent as they are.
    const report = monthlyReport({
      month: input.month,
      files: entries.map(entry => ({ file: { id: entry.upload.id, name: entry.upload.name, text: Buffer.from(entry.upload.contentBase64, 'base64').toString('utf8') }, platform: entry.platform })),
    });
    const multi = report.platforms.length > 1;
    const figures = report.receipts.map(receipt => workFigure(env, receipt, multi));
    const columns: Record<string, string> = Object.fromEntries(report.receipts.map((receipt, index) => [figures[index].key, receipt.inputs.columns.join(', ')]));
    const rows = [...new Set(report.receipts.flatMap(receipt => receipt.inputs.rows))].sort((a, b) => a - b);
    const files = report.platforms.map(platform => {
      const read = report.receipts.find(receipt => receipt.platform === platform.platform)!.inputs;
      return { id: read.fileId, name: read.fileName, digest: read.fileDigest };
    });
    const body: Omit<WorkReceiptDraft, 'digest'> = {
      operation: 'social.report', runRef: env.runRef, currency: env.currency,
      // Rows are the export's own rows as the spreadsheet numbers them (row-2 is the first under the header).
      inputs: { tables: files, columns, rowIds: rows.map(row => `row-${row}`) },
      steps: report.receipts.map((receipt, index) => workStep(receipt, figures[index])),
      figures, reconciliation: null, allowedNumbers: allowedNumbers(figures),
      explanation: figures.map(figure => `${figure.label}: ${figure.display}.`).join(' '),
      report: report.receipts.map(receipt => ({ platform: receipt.platform, month: receipt.month, key: receipt.key, formula: receipt.formula, inputs: receipt.inputs, unit: receipt.unit })),
    };
    const out = receiptOut(env, { ...body, digest: digest(body) });
    const notComputed = report.platforms.flatMap(platform => platform.missing.map(item => item.line));
    const leftOut = report.platforms.flatMap(platform => platform.excludedRows.map(item => item.reason));
    return {
      result: { receipt: out.alias, month: report.month, figures: out.figures, notComputed, leftOut: leftOut.slice(0, 20), ...(leftOut.length > 20 ? { moreLeftOut: leftOut.length - 20 } : {}) },
      receipts: [out.record], proofs: [{ kind: 'totals', receiptId: out.record.id }],
    };
  },
};

export const SOCIAL_TOOLS: Readonly<Record<SocialToolName, Spec>> = Object.freeze({ 'social.report': socialReport });

/**
 * Ink v2 wave 5: package 5-0's stubs for the social agency's tools wave 5 builds, each answering NOT_BUILT_YET. A package moves its
 * tool into the table above (and its name into that table's type) and deletes its stub line here
 * (delivery/harness/tools-playbooks.ts spreads this table).
 */
type SocialW5ToolName = Extract<ToolName, 'social.formats' | 'social.inventory' | 'social.slots' | 'social.montage' | 'social.inbox' | 'social.diagnose' | 'social.health' | 'social.adStyle' | 'social.fairPrice' | 'social.keywords'>;
export const SOCIAL_W5_TOOLS: Readonly<Record<SocialW5ToolName, Spec>> = Object.freeze({
  'social.formats': SOCIAL_CONTENT_TOOLS['social.formats'],
  'social.inventory': SOCIAL_CONTENT_TOOLS['social.inventory'],
  'social.slots': SOCIAL_CONTENT_TOOLS['social.slots'],
  'social.montage': SOCIAL_PRODUCTION_TOOLS['social.montage'],
  'social.inbox': SOCIAL_PRODUCTION_TOOLS['social.inbox'],
  'social.diagnose': SOCIAL_PRODUCTION_TOOLS['social.diagnose'],
  'social.health': SOCIAL_PRODUCTION_TOOLS['social.health'],
  'social.adStyle': SOCIAL_PRODUCTION_TOOLS['social.adStyle'],
  'social.fairPrice': notBuiltTool('social.fairPrice', 'compute', 'A creator\'s fair price from comparable posts, with a receipt, under your cap.'), // 5D3
  'social.keywords': notBuiltTool('social.keywords', 'compute', 'Keyword groups for the influencer search, competitor terms kept apart.'), // 5D3
});
