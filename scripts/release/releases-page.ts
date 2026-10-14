import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { check } from '../../platform/runtime/contracts.ts';

// The public releases page generator (plan day 10, blocks 1 and 5).
// An unsigned build is called a preview in plain words, never signed, and carries its fingerprint
// and the checksum steps for each system. An artifact that is not built yet has no download link.

export type Artifact = { os: string; arch: string; kind: string; file: string; url: string | null; sha256: string | null };
export type Release = { version: string; channel: 'preview' | 'stable'; date: string; expires: string | null; signed: boolean; signedBy: string | null; notes: string[]; checksumsUrl: string | null; artifacts: Artifact[] };
export type ReleaseFeed = { schemaVersion: 1; product: string; releases: Release[] };
type ListEntry = { name: string; lane: string; reason?: string };
export type SiteLists = { supported: ListEntry[]; experimental: ListEntry[]; later: { text: string; lane: string }[] };

export const escapeHtml = (value: unknown) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

const text = (value: unknown, field: string, max = 400): string => {
  check(typeof value === 'string' && value.trim() !== '' && value.length <= max, 'RELEASE_FIELD_INVALID', `The ${field} field must be a short piece of text.`);
  return value;
};
const optionalText = (value: unknown, field: string) => (value === null || value === undefined ? null : text(value, field));
export function httpsUrl(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  check(typeof value === 'string', 'RELEASE_FIELD_INVALID', `The ${field} field must be a link.`);
  let url: URL | null = null;
  try { url = new URL(value); } catch { url = null; }
  check(url !== null && url.protocol === 'https:' && !url.username && !url.password, 'RELEASE_LINK_NOT_HTTPS', 'Every link on the releases page must be a plain https link.');
  return url.href;
}

export function validateFeed(value: unknown): ReleaseFeed {
  check(value && typeof value === 'object' && !Array.isArray(value), 'RELEASE_FEED_INVALID', 'The releases file must hold an object.');
  const feed = value as Record<string, unknown>;
  check(feed.schemaVersion === 1, 'RELEASE_FEED_INVALID', 'The releases file must use schema version 1.');
  check(Array.isArray(feed.releases), 'RELEASE_FEED_INVALID', 'The releases file must list its releases.');
  const releases = feed.releases.map((entry): Release => {
    check(entry && typeof entry === 'object', 'RELEASE_FEED_INVALID', 'Each release must be an object.');
    const release = entry as Record<string, unknown>;
    const version = text(release.version, 'version', 64);
    check(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version), 'RELEASE_FIELD_INVALID', 'A release version must be a semantic version.');
    check(release.channel === 'preview' || release.channel === 'stable', 'RELEASE_FIELD_INVALID', 'A release channel must be preview or stable.');
    check(typeof release.signed === 'boolean', 'RELEASE_FIELD_INVALID', 'Each release must say whether it is signed.');
    const signedBy = optionalText(release.signedBy, 'signedBy');
    check(!release.signed || signedBy !== null, 'RELEASE_FIELD_INVALID', 'A signed release must name its publisher.');
    check(release.signed || release.channel === 'preview', 'RELEASE_UNSIGNED_STABLE', 'A build without a publisher signature can only ship on the preview channel.');
    check(Array.isArray(release.notes ?? []), 'RELEASE_FIELD_INVALID', 'Release notes must be a list.');
    check(Array.isArray(release.artifacts), 'RELEASE_FIELD_INVALID', 'Each release must list its artifacts.');
    const artifacts = (release.artifacts as unknown[]).map((item): Artifact => {
      check(item && typeof item === 'object', 'RELEASE_FIELD_INVALID', 'Each artifact must be an object.');
      const artifact = item as Record<string, unknown>;
      const file = text(artifact.file, 'file', 200);
      check(basename(file) === file && !file.startsWith('.'), 'RELEASE_FIELD_INVALID', 'An artifact file must be a plain file name.');
      const sha256 = artifact.sha256 ?? null;
      check(sha256 === null || (typeof sha256 === 'string' && /^[0-9a-f]{64}$/.test(sha256)), 'RELEASE_FIELD_INVALID', 'A fingerprint must be 64 lower-case hexadecimal characters.');
      return { os: text(artifact.os, 'os', 40), arch: text(artifact.arch, 'arch', 40), kind: text(artifact.kind, 'kind', 80), file, url: httpsUrl(artifact.url, 'url'), sha256 };
    });
    return {
      version, channel: release.channel, date: text(release.date, 'date', 40), expires: optionalText(release.expires, 'expires'), signed: release.signed, signedBy,
      notes: ((release.notes ?? []) as unknown[]).map((note) => text(note, 'note', 1000)), checksumsUrl: httpsUrl(release.checksumsUrl, 'checksumsUrl'), artifacts,
    };
  });
  return { schemaVersion: 1, product: text(feed.product ?? 'Chausar', 'product', 80), releases };
}

// Reads `sha256sum` output: "<hex>  <file>" or "<hex> *<file>".
export function parseSums(content: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const match = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line.trim());
    check(match, 'SHA256SUMS_INVALID', 'Each checksum line must hold a fingerprint and a file name.');
    sums.set(basename(match[2].trim()), match[1].toLowerCase());
  }
  return sums;
}

export function applySums(feed: ReleaseFeed, sums: Map<string, string>): ReleaseFeed {
  for (const release of feed.releases) for (const artifact of release.artifacts) {
    const sum = sums.get(artifact.file);
    if (!sum) continue;
    check(artifact.sha256 === null || artifact.sha256 === sum, 'RELEASE_CHECKSUM_MISMATCH', 'A checksum file disagrees with the fingerprint already recorded for an artifact.');
    artifact.sha256 = sum;
  }
  return feed;
}

const STYLE = `
:root{color-scheme:light dark;--bg:#fbfaf7;--fg:#1d1c1a;--muted:#5d5a54;--line:#d9d5cc;--card:#ffffff;--warn-bg:#fff4d6;--warn-fg:#5c3d00;--link:#0b57a4}
@media (prefers-color-scheme:dark){:root{--bg:#161513;--fg:#f1efea;--muted:#b4afa6;--line:#3a3833;--card:#1f1e1b;--warn-bg:#3d2e08;--warn-fg:#ffe2a3;--link:#8cc3ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Devanagari",sans-serif}
main{max-width:52rem;margin:0 auto;padding:2rem 1rem 4rem}h1{font-size:1.9rem;margin:0 0 .25rem}h2{margin-top:2.5rem;font-size:1.35rem}h3{font-size:1.1rem;margin:1.5rem 0 .5rem}
p.lede{color:var(--muted);margin:.25rem 0}a{color:var(--link)}code,pre{font:14px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}
pre{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:.75rem;overflow-x:auto}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:1rem;margin:1rem 0}
.warn{display:inline-block;background:var(--warn-bg);color:var(--warn-fg);border-radius:4px;padding:.1rem .45rem;font-weight:600}
table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;border-top:1px solid var(--line);padding:.5rem .4rem}
.fp{word-break:break-all;font-size:13px}.muted{color:var(--muted)}`;

function artifactRow(release: Release, artifact: Artifact) {
  const status = release.signed
    ? `<span>Signed by ${escapeHtml(release.signedBy)}</span>`
    : '<span class="warn">Preview — not signed</span>';
  let download: string;
  if (artifact.sha256 === null) download = '<span class="muted">Not built yet</span>';
  else if (artifact.url === null) download = `<span class="muted">Built, not published yet</span>`;
  else download = `<a href="${escapeHtml(artifact.url)}" rel="noopener noreferrer">Download ${escapeHtml(artifact.file)}</a> ${status}`;
  const fingerprint = artifact.sha256 === null ? '<span class="muted">No fingerprint until it is built</span>' : `<code class="fp">${escapeHtml(artifact.sha256)}</code>`;
  return `<tr><th scope="row">${escapeHtml(artifact.os)} <span class="muted">${escapeHtml(artifact.arch)}</span><br><span class="muted">${escapeHtml(artifact.kind)}</span></th><td>${download}<br><code>${escapeHtml(artifact.file)}</code></td><td>SHA-256: ${fingerprint}</td></tr>`;
}

function checksumSteps(release: Release) {
  const file = (os: string) => escapeHtml(release.artifacts.find((artifact) => artifact.os.toLowerCase() === os)?.file ?? '<file>');
  return `<h3>Check the fingerprint before you install</h3>
<p>Compare the SHA-256 fingerprint printed by your computer with the one on this page. If they differ, do not install the file.</p>
<h4>Windows (PowerShell or Command Prompt)</h4>
<pre>Get-FileHash -Algorithm SHA256 ${file('windows')}
certutil -hashfile ${file('windows')} SHA256</pre>
<h4>macOS (Terminal)</h4>
<pre>shasum -a 256 ${file('macos')}</pre>
<h4>Linux (terminal, in the folder with the download and SHA256SUMS)</h4>
<pre>sha256sum -c SHA256SUMS</pre>`;
}

function releaseSection(release: Release, index: number) {
  const headingId = `release-${index}`;
  const state = release.signed
    ? `<p>This build is signed by ${escapeHtml(release.signedBy)}. Windows may still warn about a new publisher at first.</p>`
    : `<p><span class="warn">Preview — not signed</span> This build has no publisher certificate. Windows will warn that the publisher is unknown. Check the fingerprint below before you install, and do not install it on a shop computer that holds real books yet.</p>`;
  const sums = release.checksumsUrl ? `<p><a href="${escapeHtml(release.checksumsUrl)}" rel="noopener noreferrer">SHA256SUMS for this release</a></p>` : '';
  return `<section class="card" aria-labelledby="${headingId}">
<h2 id="${headingId}">${escapeHtml(release.version)} <span class="muted">(${escapeHtml(release.channel)}, ${escapeHtml(release.date)})</span></h2>
${state}
${release.expires ? `<p>This ${release.channel === 'preview' ? 'preview' : 'build'} expires on ${escapeHtml(release.expires)}.</p>` : ''}
${release.notes.length ? `<ul>${release.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>` : ''}
<table><caption class="muted">Downloads for ${escapeHtml(release.version)}</caption><thead><tr><th scope="col">System</th><th scope="col">Download</th><th scope="col">Fingerprint</th></tr></thead><tbody>
${release.artifacts.map((artifact) => artifactRow(release, artifact)).join('\n')}
</tbody></table>
${sums}
${checksumSteps(release)}
</section>`;
}

function listsSection(lists: SiteLists | null) {
  if (!lists) return '';
  const item = (entry: ListEntry) => `<li>${escapeHtml(entry.name)}</li>`;
  return `<section aria-labelledby="lists">
<h2 id="lists">What this release supports</h2>
<h3>Supported</h3>
<p class="muted">Each item passed the bench and a hidden case on the release candidate.</p>
${lists.supported.length ? `<ul>${lists.supported.map(item).join('')}</ul>` : '<p>Nothing is on the supported list yet.</p>'}
<h3>Experimental</h3>
<p class="muted">Shown working, but not proven on the bench and a hidden case.</p>
${lists.experimental.length ? `<ul>${lists.experimental.map(item).join('')}</ul>` : '<p>Nothing is on the experimental list.</p>'}
<h3>Left for later</h3>
${lists.later.length ? `<ul>${lists.later.map((entry) => `<li>${escapeHtml(entry.text)}</li>`).join('')}</ul>` : '<p>Nothing is listed.</p>'}
</section>`;
}

export function renderReleasesPage(feed: ReleaseFeed, lists: SiteLists | null = null): string {
  const styleHash = createHash('sha256').update(STYLE).digest('base64');
  const csp = `default-src 'none'; style-src 'sha256-${styleHash}'; img-src 'none'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(feed.product)} releases</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<header>
<h1>${escapeHtml(feed.product)} releases</h1>
<p class="lede">Every number has a receipt. Download the app, check its fingerprint, and run it on your own computer.</p>
<p class="lede" lang="hi">हर संख्या की रसीद। ऐप डाउनलोड करें, उसका फ़िंगरप्रिंट जाँचें, और उसे अपने कंप्यूटर पर चलाएँ।</p>
</header>
${feed.releases.length ? feed.releases.map(releaseSection).join('\n') : '<p>No release is published yet.</p>'}
${listsSection(lists)}
</main>
</body>
</html>
`;
}

async function readLists(path: string): Promise<SiteLists | null> {
  let content: string;
  try { content = await readFile(path, 'utf8'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const value = JSON.parse(content) as Partial<SiteLists>;
  check(Array.isArray(value.supported) && Array.isArray(value.experimental) && Array.isArray(value.later), 'LISTS_INVALID', 'The lists file must hold supported, experimental and later lists.');
  return value as SiteLists;
}

export async function buildReleasesPage(options: { input: string; sums?: string[]; lists?: string; out: string }) {
  const feed = validateFeed(JSON.parse(await readFile(options.input, 'utf8')));
  for (const path of options.sums ?? []) applySums(feed, parseSums(await readFile(path, 'utf8')));
  const lists = options.lists ? await readLists(options.lists) : null;
  await mkdir(options.out, { recursive: true });
  const html = renderReleasesPage(feed, lists);
  await writeFile(join(options.out, 'index.html'), html);
  await writeFile(join(options.out, 'releases.json'), `${JSON.stringify(feed, null, 2)}\n`);
  return { feed, html };
}

export async function main(args: string[]) {
  const value = (name: string) => { const index = args.indexOf(name); if (index === -1) return undefined; check(index + 1 < args.length, 'CLI_OPTION_VALUE', 'An option is missing its value.'); return args[index + 1]; };
  const sums = args.flatMap((arg, index) => (arg === '--sums' && index + 1 < args.length ? [resolve(args[index + 1])] : []));
  const out = resolve(value('--out') ?? 'release/site/releases');
  const { feed } = await buildReleasesPage({ input: resolve(value('--input') ?? 'scripts/release/releases.json'), sums, lists: resolve(value('--lists') ?? join(out, '..', 'lists.json')), out });
  process.stdout.write(`Releases page written to ${out} for ${feed.releases.length} release(s).\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error: Error & { code?: string }) => { process.stderr.write(`${error.code ?? 'FAILED'} ${error.message}\n`); process.exitCode = 1; });
}
