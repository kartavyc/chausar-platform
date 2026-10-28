// Shared exact report arithmetic for the engine and the browser demo. Hashing is supplied by the host.
import {csvRows} from '../../../csv.ts';
type IsoDate=string;
export type ExportPlatform = 'instagram' | 'linkedin';
export type MetricKey = 'views' | 'reach' | 'impressions' | 'likes' | 'comments' | 'shares' | 'saves' | 'clicks' | 'follows';
export type ReportFigureKey = 'posts' | 'views' | 'reach' | 'impressions' | 'engagements' | 'engagement-rate' | 'follows' | 'top-post';
export type DateOrder = 'month-day-year' | 'day-month-year';

export type ExportProfile = {
  platform: ExportPlatform;
  name: string;
  ruleId: string;
  postId: string[];
  published: string[];
  /** Header names per metric, compared without case. */
  metrics: Partial<Record<MetricKey, string[]>>;
  dateOrder: DateOrder;
  totals: { key: ReportFigureKey; metric: MetricKey; label: string; formula: string }[];
  engagement: { parts: MetricKey[]; denominator: MetricKey; formula: string };
};

export const EXPORT_PROFILES: Readonly<Record<ExportPlatform, ExportProfile>> = Object.freeze({
  instagram: {
    platform: 'instagram', name: 'Instagram content export', ruleId: 'export-meta-content',
    postId: ['Post ID'], published: ['Publish time'], dateOrder: 'month-day-year',
    metrics: { views: ['Views'], reach: ['Reach'], likes: ['Likes'], comments: ['Comments'], shares: ['Shares'], saves: ['Saves'], follows: ['Follows'] },
    totals: [
      { key: 'views', metric: 'views', label: 'Views', formula: 'Views added up over the posts published in the month.' },
      { key: 'reach', metric: 'reach', label: 'Reach', formula: 'Reach added up over the posts published in the month. One account that saw two posts is counted more than once.' },
      { key: 'follows', metric: 'follows', label: 'Follows from posts', formula: 'Follows the export credits to the posts published in the month.' },
    ],
    engagement: {
      parts: ['likes', 'comments', 'shares', 'saves'], denominator: 'reach',
      formula: 'Engagements are likes, comments, shares and saves added together. The rate is engagements divided by reach added up over the posts, as a percent to two decimal places, rounded half up.',
    },
  },
  linkedin: {
    platform: 'linkedin', name: 'LinkedIn updates export', ruleId: 'export-linkedin-updates',
    postId: ['Update link'], published: ['Created date'], dateOrder: 'month-day-year',
    metrics: { impressions: ['Impressions'], clicks: ['Clicks'], likes: ['Likes'], comments: ['Comments'], shares: ['Reposts'], follows: ['Follows'] },
    totals: [
      { key: 'impressions', metric: 'impressions', label: 'Impressions', formula: 'Impressions added up over the posts published in the month.' },
      { key: 'follows', metric: 'follows', label: 'Follows from posts', formula: 'Follows the export credits to the posts published in the month.' },
    ],
    engagement: {
      parts: ['clicks', 'likes', 'comments', 'shares', 'follows'], denominator: 'impressions',
      formula: "Engagements are clicks, likes, comments, reposts and follows added together, as LinkedIn counts them. The rate is engagements divided by impressions, as a percent to two decimal places, rounded half up. The export's own rate column is never copied.",
    },
  },
} satisfies Record<ExportPlatform, ExportProfile>);

/** A file the client uploaded: its id in the order files, its name and its text. */
export type ExportFile = { id: string; name: string; text: string };
export type ParsedRow = {
  /** The spreadsheet row: the header is row 1. */
  row: number;
  postId: string;
  published: IsoDate | null;
  publishedText: string;
  values: Partial<Record<MetricKey, bigint | null>>;
  problems: Partial<Record<MetricKey, string>>;
};
export type ParsedExport = {
  platform: ExportPlatform;
  file: { id: string; name: string; digest: string };
  columns: { postId: string; published: string; metrics: Partial<Record<MetricKey, string>> };
  rows: ParsedRow[];
};
export type ReportReceipt = {
  id: string;
  platform: ExportPlatform;
  month: string;
  key: ReportFigureKey;
  label: string;
  /** Exact: a whole number, a percent to two places, or a post id. */
  value: string;
  display: string;
  unit: 'count' | 'percent' | 'post';
  formula: string;
  inputs: { fileId: string; fileName: string; fileDigest: string; columns: string[]; rows: number[] };
  numerator?: string;
  denominator?: string;
  digest: string;
};
export type PlatformReport = {
  platform: ExportPlatform;
  month: string;
  fileId: string;
  posts: number;
  receipts: ReportReceipt[];
  missing: { key: ReportFigureKey; line: string }[];
  excludedRows: { row: number; reason: string }[];
};
export type ReportOptions = { dateOrder?: DateOrder; numberStyle?: 'international' | 'indian' };

export type ReportSeals={text(value:string):string;value(value:unknown):string;error(code:string,message:string):Error};
export function createReportComputer(seals:ReportSeals){
const refuse = (code: string, message: string): never => { throw seals.error(code, message); };
function check(value: unknown, code:string, message:string): asserts value { if(!value) refuse(code,message); }
const sha256=seals.text; const digest=seals.value;
const pad = (value: number) => String(value).padStart(2, '0');
const METRIC_WORD: Record<MetricKey, string> = {
  views: 'Views', reach: 'Reach', impressions: 'Impressions', likes: 'Likes', comments: 'Comments', shares: 'Shares', saves: 'Saves', clicks: 'Clicks', follows: 'Follows',
};

/** A whole number with grouping: 21,735 or, in the Indian style, 1,21,735. Digits only, no floating point. */
function groupDigits(value: bigint, style: 'international' | 'indian' = 'international'): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString();
  let grouped: string;
  if (style === 'indian' && digits.length > 3) {
    const head = digits.slice(0, -3);
    grouped = `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${digits.slice(-3)}`;
  } else {
    grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  return negative ? `-${grouped}` : grouped;
}

function realDate(year: number, month: number, day: number): IsoDate | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const back = new Date(Date.UTC(year, month - 1, day));
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The date part of a published cell: 2026-09-02, or 09/02/2026 read in the export's order. Anything else is null. */
function publishedDate(text: string, order: DateOrder): IsoDate | null {
  const head = text.trim().split(/[\sT]/)[0] ?? '';
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(head);
  if (match) return realDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(head);
  if (!match) return null;
  const [first, second, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return order === 'month-day-year' ? realDate(year, first, second) : realDate(year, second, first);
}

/** A count cell: digits with optional grouping commas, or a decimal whose fraction is all zeros. */
function countCell(raw: string): { value: bigint | null; problem: string | null } {
  const text = raw.trim();
  if (!text) return { value: null, problem: 'is empty' };
  if (/^\d+$/.test(text) || /^\d{1,3}(?:,\d{3})+$/.test(text) || /^\d{1,2}(?:,\d{2})*,\d{3}$/.test(text)) return { value: BigInt(text.replace(/,/g, '')), problem: null };
  const decimal = /^(\d+)\.(\d+)$/.exec(text);
  if (decimal && /^0+$/.test(decimal[2]!)) return { value: BigInt(decimal[1]!), problem: null };
  if (decimal) return { value: null, problem: `is ${text}, not a whole number` };
  return { value: null, problem: `is "${text.slice(0, 40)}", not a count` };
}

function findColumn(headers: string[], names: string[]): number {
  const wanted = names.map(name => name.toLowerCase());
  return headers.findIndex(header => wanted.includes(header.trim().toLowerCase()));
}

/**
 * Reads a client's export by column name. A file without the post id, the published date or any metric column the
 * profile names is refused as not this kind of export. Cells are parsed, never trusted: each problem is kept.
 */
function parseExport(file: ExportFile, platform: ExportPlatform, options: ReportOptions = {}): ParsedExport {
  const profile = EXPORT_PROFILES[platform];
  check(profile, 'INVALID_VENTURE_REQUEST', 'The report reads Instagram and LinkedIn exports.');
  check(file && typeof file.text === 'string' && typeof file.id === 'string', 'INVALID_VENTURE_REQUEST', 'Send the uploaded file.');
  let rows: string[][];
  try { rows = csvRows(file.text); } catch { return refuse('EXPORT_NOT_RECOGNISED', `${file.name} is not a readable CSV file.`); }
  if (!rows.length) refuse('EXPORT_NOT_RECOGNISED', `${file.name} is empty.`);
  const headers = rows[0]!.map(header => header.trim());
  const postIdAt = findColumn(headers, profile.postId);
  const publishedAt = findColumn(headers, profile.published);
  const missingColumns = [
    ...(postIdAt < 0 ? [profile.postId[0]] : []), ...(publishedAt < 0 ? [profile.published[0]] : []),
    ...Object.entries(profile.metrics).filter(([, names]) => findColumn(headers, names!) < 0).map(([, names]) => names![0]),
  ];
  if (missingColumns.length) refuse('EXPORT_NOT_RECOGNISED', `${file.name} does not look like an ${profile.name}: it has no ${missingColumns.join(', ')} column.`);
  const metricAt = Object.fromEntries(Object.entries(profile.metrics).map(([key, names]) => [key, findColumn(headers, names!)])) as Partial<Record<MetricKey, number>>;
  const order = options.dateOrder ?? profile.dateOrder;
  const parsed: ParsedRow[] = rows.slice(1).map((cells, index) => {
    const values: ParsedRow['values'] = {};
    const problems: ParsedRow['problems'] = {};
    for (const [key, at] of Object.entries(metricAt) as [MetricKey, number][]) {
      const result = countCell(cells[at] ?? '');
      values[key] = result.value;
      if (result.problem) problems[key] = result.problem;
    }
    const publishedText = (cells[publishedAt] ?? '').trim();
    return { row: index + 2, postId: (cells[postIdAt] ?? '').trim(), published: publishedDate(publishedText, order), publishedText, values, problems };
  });
  return {
    platform,
    file: { id: file.id, name: file.name, digest: sha256(file.text) },
    columns: {
      postId: headers[postIdAt]!, published: headers[publishedAt]!,
      metrics: Object.fromEntries(Object.entries(metricAt).map(([key, at]) => [key, headers[at!]])) as Partial<Record<MetricKey, string>>,
    },
    rows: parsed,
  };
}

function receipt(base: Omit<ReportReceipt, 'id' | 'digest'>): ReportReceipt {
  const sealed = digest(base);
  return { id: `sr_${sealed.slice(0, 16)}`, ...base, digest: sealed };
}

/** Hundredths of a percent, rounded half up, from whole numbers only. */
function percentHundredths(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 10000n * 2n + denominator) / (2n * denominator);
}

/**
 * The figures for one platform and one month. Rows outside the month, or with a date that is not real, are left out
 * and listed. A post id seen twice refuses the whole file. Each figure needs every cell it adds up; one missing cell
 * stops that figure and is named in missing.
 */
function computePlatformReport(file: ExportFile, platform: ExportPlatform, month: string, options: ReportOptions = {}): PlatformReport {
  check(typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month), 'INVALID_VENTURE_REQUEST', 'Give the month like 2026-09.');
  const profile = EXPORT_PROFILES[platform];
  const parsed = parseExport(file, platform, options);
  const style = options.numberStyle ?? 'international';
  const seen = new Map<string, number>();
  for (const row of parsed.rows) {
    if (!row.postId) continue;
    const before = seen.get(row.postId);
    if (before !== undefined) refuse('EXPORT_DUPLICATE_POST', `The post ${row.postId} is in rows ${before} and ${row.row}. Export the month again, once.`);
    seen.set(row.postId, row.row);
  }
  const excludedRows: PlatformReport['excludedRows'] = [];
  const rows: ParsedRow[] = [];
  for (const row of parsed.rows) {
    if (!row.postId) excludedRows.push({ row: row.row, reason: `Row ${row.row} has no ${parsed.columns.postId}.` });
    else if (!row.published) excludedRows.push({ row: row.row, reason: `The date "${row.publishedText}" in row ${row.row} is not a real date.` });
    else if (!row.published.startsWith(`${month}-`)) excludedRows.push({ row: row.row, reason: `Published on ${row.published}, outside ${month}.` });
    else rows.push(row);
  }
  const rowNumbers = rows.map(row => row.row);
  const inputs = (columns: string[]) => ({ fileId: parsed.file.id, fileName: parsed.file.name, fileDigest: parsed.file.digest, columns, rows: [...rowNumbers] });
  const receipts: ReportReceipt[] = [];
  const missing: PlatformReport['missing'] = [];
  const column = (metric: MetricKey) => parsed.columns.metrics[metric]!;

  /** The sum of one metric over the month's rows, or null with the reason when any cell is missing or broken. */
  const total = (metric: MetricKey): { value: bigint; problem: null } | { value: null; problem: string } => {
    const broken = rows.filter(row => row.values[metric] === null || row.values[metric] === undefined);
    if (broken.length) {
      const where = broken.map(row => `row ${row.row}`).join(', ');
      const why = broken.map(row => row.problems[metric]).find(Boolean) ?? 'is missing';
      return { value: null, problem: `${column(metric)} ${why} in ${where}. Unknown is never counted as zero` };
    }
    return { value: rows.reduce((sum, row) => sum + (row.values[metric] as bigint), 0n), problem: null };
  };

  receipts.push(receipt({
    platform, month, key: 'posts', label: 'Posts', value: String(rows.length), display: groupDigits(BigInt(rows.length), style), unit: 'count',
    formula: `Posts in the export published in ${month}.`, inputs: inputs([parsed.columns.postId, parsed.columns.published]),
  }));
  for (const item of profile.totals) {
    const sum = total(item.metric);
    if (sum.value === null) { missing.push({ key: item.key, line: `${item.label} is not computed: ${sum.problem}.` }); continue; }
    receipts.push(receipt({
      platform, month, key: item.key, label: item.label, value: sum.value.toString(), display: groupDigits(sum.value, style), unit: 'count',
      formula: item.formula, inputs: inputs([column(item.metric)]),
    }));
  }
  const parts = profile.engagement.parts.map(metric => ({ metric, sum: total(metric) }));
  const brokenPart = parts.find(part => part.sum.value === null);
  const partColumns = profile.engagement.parts.map(column);
  let engagements: bigint | null = null;
  if (brokenPart) {
    missing.push({ key: 'engagements', line: `Engagements are not computed: ${brokenPart.sum.problem}.` });
    missing.push({ key: 'engagement-rate', line: 'The engagement rate is not computed, because engagements are not.' });
    missing.push({ key: 'top-post', line: 'The top post is not picked, because engagements are not complete.' });
  } else {
    engagements = parts.reduce((sum, part) => sum + (part.sum.value as bigint), 0n);
    receipts.push(receipt({
      platform, month, key: 'engagements', label: 'Engagements', value: engagements.toString(), display: groupDigits(engagements, style), unit: 'count',
      formula: profile.engagement.formula, inputs: inputs(partColumns),
    }));
    const denominator = total(profile.engagement.denominator);
    if (denominator.value === null) {
      missing.push({ key: 'engagement-rate', line: `The engagement rate is not computed: ${denominator.problem}.` });
    } else if (denominator.value === 0n) {
      missing.push({ key: 'engagement-rate', line: `The engagement rate is not computed: ${METRIC_WORD[profile.engagement.denominator]} adds up to zero.` });
    } else {
      const hundredths = percentHundredths(engagements, denominator.value);
      const value = `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`;
      receipts.push(receipt({
        platform, month, key: 'engagement-rate', label: 'Engagement rate', value, display: `${value}%`, unit: 'percent',
        formula: profile.engagement.formula, inputs: inputs([...partColumns, column(profile.engagement.denominator)]),
        numerator: engagements.toString(), denominator: denominator.value.toString(),
      }));
    }
    if (rows.length) {
      const scored = rows.map(row => ({ row, score: profile.engagement.parts.reduce((sum, metric) => sum + (row.values[metric] as bigint), 0n) }));
      const top = scored.reduce((best, item) => (item.score > best.score
        || (item.score === best.score && (item.row.published! < best.row.published! || (item.row.published === best.row.published && item.row.row < best.row.row))) ? item : best));
      receipts.push(receipt({
        platform, month, key: 'top-post', label: 'Top post by engagements', value: top.row.postId, display: `${top.row.postId} (${groupDigits(top.score, style)} engagements)`, unit: 'post',
        formula: 'The post with the most engagements; a tie goes to the earlier post.', inputs: { ...inputs([parsed.columns.postId, ...partColumns]), rows: [top.row.row] },
        numerator: top.score.toString(),
      }));
    }
  }
  return { platform, month, fileId: parsed.file.id, posts: rows.length, receipts, missing, excludedRows };
}

/** The month's report over every uploaded export, one platform after another. */
function monthlyReport(input: { month: string; files: { file: ExportFile; platform: ExportPlatform; dateOrder?: DateOrder }[]; numberStyle?: 'international' | 'indian' }): {
  month: string; platforms: PlatformReport[]; receipts: ReportReceipt[];
} {
  check(Array.isArray(input.files) && input.files.length >= 1 && input.files.length <= 12, 'INVALID_VENTURE_REQUEST', 'Upload between one and twelve exports for the report.');
  const platforms = input.files.map(item => computePlatformReport(item.file, item.platform, input.month, { dateOrder: item.dateOrder, numberStyle: input.numberStyle }));
  return { month: input.month, platforms, receipts: platforms.flatMap(item => item.receipts) };
}

return {groupDigits,parseExport,computePlatformReport,monthlyReport};
}
