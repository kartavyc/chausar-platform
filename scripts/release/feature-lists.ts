import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { check } from '../../platform/runtime/contracts.ts';

// The supported and experimental lists generator (plan day 10, block 5).
// Every lane writes docs/lanes/<lane-id>.md and labels each feature **supported** or **experimental**.
// This reads them leniently, keeps an item supported only when the release candidate's bench and a
// hidden case both passed, and writes the lists the website and the coverage board may quote.

export type Label = 'supported' | 'experimental';
export type Feature = { lane: string; name: string; label: Label; file: string; line: number; claimed: Label; reason?: string };
export type LaterItem = { lane: string; text: string; file: string; line: number };
export type ParseError = { file: string; line: number; code: string; message: string };
export type Evidence = { feature: string; lane: string; bench: 'passed' | null; hiddenCase: 'passed' | null };
export type FeatureLists = { supported: Feature[]; experimental: Feature[]; later: LaterItem[]; lanes: string[] };
export type ClaimFinding = { kind: 'experimental-unlabelled' | 'later-unlabelled' | 'unbacked-number'; sentence: string; feature?: string; number?: string };

export const DEMOTION_REASON = 'no bench and hidden-case evidence on the release candidate';
const LATER_HEADING = /^(?:still missing|gaps|remaining gaps|what is still missing|left for later|known gaps)\b/i;

// Removes the light markdown a lane document puts around a name.
export function stripMarkup(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$|[.,:;])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}
const key = (name: string) => stripMarkup(name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const labelOf = (cell: string): Label | null => {
  const match = /^[\s*_`(]*(supported|experimental)[\s*_`)]*\.?$/i.exec(cell);
  return match ? (match[1].toLowerCase() as Label) : null;
};

type Raw = { name: string; labels: Label[]; line: number };

// Parses one lane document. Returns the labelled items, the left-for-later items and the parse errors.
export function parseLaneDoc(text: string, lane: string, file: string) {
  const items: Raw[] = [];
  const later: LaterItem[] = [];
  const errors: ParseError[] = [];
  let inFence = false;
  let inLater = false;
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = index + 1;
    if (/^\s*(```|~~~)/.test(raw)) { inFence = !inFence; return; }
    if (inFence) return;
    const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(raw);
    const boldHeading = /^\s*\*\*([^*]+)\*\*:?\s*$/.exec(raw);
    if (heading || boldHeading) {
      inLater = LATER_HEADING.test(stripMarkup((heading ?? boldHeading)![1]).replace(/:$/, ''));
      return;
    }
    if (/^\s*\|/.test(raw)) {
      const cells = raw.trim().replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim());
      if (cells.every((cell) => /^:?-{2,}:?$/.test(cell) || cell === '')) return;
      const labels = [...new Set(cells.slice(1).map(labelOf).filter((label): label is Label => label !== null))];
      const name = stripMarkup(cells[0] ?? '');
      if (labels.length && name && !labelOf(name)) items.push({ name, labels, line });
      return;
    }
    const item = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(raw);
    if (!item) return;
    const body = item[1].trim();
    if (inLater) { if (stripMarkup(body)) later.push({ lane, text: stripMarkup(body), file, line }); return; }
    const labels = new Set<Label>();
    for (const match of body.matchAll(/(\*\*|__|`|\()\s*(supported|experimental)\s*(\*\*|__|`|\))/gi)) labels.add(match[2].toLowerCase() as Label);
    const colon = /^([^:]+):\s*[*_`(]*\s*(supported|experimental)\b/i.exec(body);
    if (colon) labels.add(colon[2].toLowerCase() as Label);
    if (!labels.size) return;
    const bold = /^\*\*(.+?)\*\*/.exec(body);
    let name = bold ? bold[1] : body.split(/:|\s+[—–]\s+|\s+-\s+|\s*\(/)[0];
    name = stripMarkup(name).replace(/[.:]$/, '');
    if (!name || labelOf(name)) {
      errors.push({ file, line, code: 'FEATURE_NAME_MISSING', message: 'A labelled list item has no feature name.' });
      return;
    }
    items.push({ name, labels: [...labels], line });
  });
  if (inFence) errors.push({ file, line: lines.length, code: 'UNCLOSED_FENCE', message: 'A code fence is never closed.' });
  return { items, later, errors };
}

function validateEvidence(value: unknown): Evidence[] {
  check(Array.isArray(value), 'EVIDENCE_INVALID', 'The evidence file must hold a list.');
  return value.map((entry) => {
    check(entry && typeof entry === 'object', 'EVIDENCE_INVALID', 'Each evidence entry must be an object.');
    const { feature, lane, bench, hiddenCase } = entry as Record<string, unknown>;
    check(typeof feature === 'string' && feature.trim() !== '', 'EVIDENCE_INVALID', 'Each evidence entry needs a feature name.');
    check(typeof lane === 'string' && lane.trim() !== '', 'EVIDENCE_INVALID', 'Each evidence entry needs a lane id.');
    check(bench === 'passed' || bench === null, 'EVIDENCE_INVALID', 'Bench evidence must be passed or null.');
    check(hiddenCase === 'passed' || hiddenCase === null, 'EVIDENCE_INVALID', 'Hidden-case evidence must be passed or null.');
    return { feature, lane, bench, hiddenCase };
  });
}

export async function readEvidence(path: string): Promise<Evidence[]> {
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = undefined; }
  return validateEvidence(parsed);
}

// Builds the lists from lane documents held in memory: { 'lane-id': markdown }.
export function buildFeatureLists(docs: Record<string, string>, evidence: Evidence[], fileFor = (lane: string) => `docs/lanes/${lane}.md`) {
  const errors: ParseError[] = [];
  const later: LaterItem[] = [];
  const byName = new Map<string, Feature>();
  const features: Feature[] = [];
  const lanes = Object.keys(docs).sort();
  for (const lane of lanes) {
    const file = fileFor(lane);
    const parsed = parseLaneDoc(docs[lane], lane, file);
    errors.push(...parsed.errors);
    later.push(...parsed.later);
    for (const item of parsed.items) {
      const id = key(item.name);
      if (item.labels.length > 1) {
        errors.push({ file, line: item.line, code: 'FEATURE_BOTH_LABELS', message: `The feature "${item.name}" is labelled both supported and experimental.` });
        continue;
      }
      const label = item.labels[0];
      const earlier = byName.get(id);
      if (earlier && earlier.claimed !== label) {
        errors.push({ file, line: item.line, code: 'FEATURE_BOTH_LABELS', message: `The feature "${item.name}" is labelled ${label} here and ${earlier.claimed} in ${earlier.file} line ${earlier.line}.` });
        continue;
      }
      if (!earlier) byName.set(id, { lane, name: item.name, label, claimed: label, file, line: item.line });
      // The same feature in two lanes with the same label is kept once per lane; repeats inside one lane are dropped.
      if (!features.some((feature) => feature.lane === lane && key(feature.name) === id)) features.push({ lane, name: item.name, label, claimed: label, file, line: item.line });
    }
  }
  const proven = new Set(evidence.filter((entry) => entry.bench === 'passed' && entry.hiddenCase === 'passed').map((entry) => `${entry.lane}\u0000${key(entry.feature)}`));
  for (const feature of features) {
    if (feature.label === 'supported' && !proven.has(`${feature.lane}\u0000${key(feature.name)}`)) {
      feature.label = 'experimental';
      feature.reason = DEMOTION_REASON;
    }
  }
  const order = (a: Feature, b: Feature) => a.lane.localeCompare(b.lane) || a.line - b.line;
  const lists: FeatureLists = {
    supported: features.filter((feature) => feature.label === 'supported').sort(order),
    experimental: features.filter((feature) => feature.label === 'experimental').sort(order),
    later,
    lanes,
  };
  return { lists, errors };
}

export async function readLaneDocs(directory: string): Promise<Record<string, string>> {
  let names: string[];
  try { names = await readdir(directory); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  const docs: Record<string, string> = {};
  for (const name of names.filter((entry) => entry.endsWith('.md')).sort()) docs[basename(name, '.md')] = await readFile(join(directory, name), 'utf8');
  return docs;
}

const mdEscape = (text: string) => text.replace(/([\\`*_[\]|<>])/g, '\\$1');

export function renderMarkdown(lists: FeatureLists) {
  const row = (feature: Feature) => `- ${mdEscape(feature.name)} (${feature.lane}${feature.reason ? `; claimed supported, ${feature.reason}` : ''})`;
  const supported = ['# Supported', '', 'Each item passed the bench and a hidden case on the release candidate.', '', ...(lists.supported.length ? lists.supported.map(row) : ['Nothing is supported yet.']), ''].join('\n');
  const experimental = ['# Experimental', '', 'Each item was shown working, but it depends on a live service, device or account that was not tested, or it lacks bench and hidden-case evidence.', '', ...(lists.experimental.length ? lists.experimental.map(row) : ['Nothing is listed as experimental.']), ''].join('\n');
  const later = ['# Left for later', '', ...(lists.later.length ? lists.later.map((item) => `- ${mdEscape(item.text)} (${item.lane})`) : ['Nothing is listed.']), ''].join('\n');
  return { supported, experimental, later };
}

export async function writeFeatureLists(lists: FeatureLists, out: string) {
  await mkdir(out, { recursive: true });
  const md = renderMarkdown(lists);
  await writeFile(join(out, 'lists.json'), `${JSON.stringify({ schemaVersion: 1, ...lists }, null, 2)}\n`);
  await writeFile(join(out, 'supported.md'), md.supported);
  await writeFile(join(out, 'experimental.md'), md.experimental);
  await writeFile(join(out, 'later.md'), md.later);
}

// Con's check of the website against the two lists. Every flagged sentence either names an
// experimental (or left-for-later) feature without saying so, or carries a number with no bench run.
export function checkClaims(websiteText: string, lists: Pick<FeatureLists, 'experimental'> & Partial<Pick<FeatureLists, 'later'>>, allowedNumbers: readonly (string | number)[] = []): ClaimFinding[] {
  const plain = /<[a-z!/][^>]*>/i.test(websiteText)
    ? websiteText.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(p|li|h[1-6]|div|section|tr|td|th|dd|dt)>|<br\s*\/?>/gi, '\n\n').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    : websiteText;
  const sentences = plain.split(/(?<=[.!?।])\s+|\n\s*\n|\n(?=\s*(?:[-*+#|]|\d+[.)]\s))/).map((sentence) => sentence.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const allowed = new Set(allowedNumbers.map((number) => String(number).replace(/,/g, '')));
  const findings: ClaimFinding[] = [];
  const names = (items: { name?: string; text?: string }[]) => items.map((item) => stripMarkup(item.name ?? item.text ?? '')).filter((name) => name.length > 1);
  const mentions = (sentence: string, name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(sentence);
  for (const sentence of sentences) {
    const saysExperimental = /\bexperimental\b|प्रयोगात्मक/i.test(sentence);
    for (const name of names(lists.experimental)) if (!saysExperimental && mentions(sentence, name)) findings.push({ kind: 'experimental-unlabelled', sentence, feature: name });
    for (const name of names(lists.later ?? [])) if (!saysExperimental && !/\b(planned|later|not (built )?yet)\b/i.test(sentence) && mentions(sentence, name)) findings.push({ kind: 'later-unlabelled', sentence, feature: name });
    for (const match of sentence.matchAll(/\d(?:[\d,]*\d)?(?:\.\d+)?/g)) {
      const number = match[0].replace(/,/g, '');
      if (!allowed.has(number)) findings.push({ kind: 'unbacked-number', sentence, number: match[0] });
    }
  }
  return findings;
}

function option(args: string[], name: string, fallback: string) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  check(index + 1 < args.length, 'CLI_OPTION_VALUE', 'An option is missing its value.');
  return args[index + 1];
}

export async function main(args: string[]) {
  const lanes = resolve(option(args, '--lanes', 'docs/lanes'));
  const evidencePath = resolve(option(args, '--evidence', 'scripts/release/supported-evidence.json'));
  const out = resolve(option(args, '--out', 'release/site'));
  const { lists, errors } = buildFeatureLists(await readLaneDocs(lanes), await readEvidence(evidencePath), (lane) => join(lanes, `${lane}.md`));
  for (const error of errors) process.stderr.write(`${error.file}:${error.line} ${error.code} ${error.message}\n`);
  if (errors.length) return 1;
  await writeFeatureLists(lists, out);
  const demoted = lists.experimental.filter((feature) => feature.reason).length;
  process.stdout.write(`Lists written to ${out}: ${lists.supported.length} supported, ${lists.experimental.length} experimental (${demoted} demoted), ${lists.later.length} left for later, from ${lists.lanes.length} lane documents.\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error: Error & { code?: string }) => { process.stderr.write(`${error.code ?? 'FAILED'} ${error.message}\n`); process.exitCode = 1; });
}
