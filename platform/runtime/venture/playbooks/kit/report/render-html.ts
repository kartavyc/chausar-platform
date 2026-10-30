// Chausar playbook kit (Ink v2 wave 5, package 5A5, P11): a client report as one self-contained HTML file. Its only
// style is inside it, allowed by its own hash; it loads nothing (no script, image, font or address outside it), so it
// opens the same offline, attached to a mail or on the hosted page. The only address it may carry is the report's own
// share link. Every value is escaped; Hindi words are marked lang="hi"; figures show their receipt; a title, heading or
// prose with a number no receipt backs says "Model estimate"; a quote says "Shown as written". Bars are drawn by width
// classes, never an inline style. The same input gives the same bytes: the date it shows is passed in. The idea of a report renderer
// with typed blocks comes from beyondseo (MIT), catalogue row P11; no code of it was read or copied. Written for Chausar.
import {sha256} from '@noble/hashes/sha2.js';
import {utf8ToBytes} from '@noble/hashes/utils.js';
import type { ReportBlock } from '../records-report.ts';

/** What a report file shows: its title, the business, the date it is as of (in words), its blocks, and its link. */
export type ReportDocument = { title: string; titleEstimate?: boolean; business: string; asOf: string; blocks: readonly ReportBlock[]; link?: string | null };

/** The fixed words a report carries, in English. */
export const REPORT_WORDS = Object.freeze({
  estimate: 'Model estimate',
  asWritten: 'Shown as written',
  receipt: 'Receipt',
  preparedBy: 'Prepared by',
  asOf: 'As of',
  footer: 'Every figure comes from a receipt Chausar keeps. Words with a number and no receipt are marked as a model estimate.',
  online: 'Read this report online:',
});

const DEVANAGARI = /[ऀ-ॿ꣠-ꣿ]/;
/** Whether any words hold Devanagari: the report then needs a font that draws Hindi. */
export function hasDevanagari(text: string): boolean {
  return DEVANAGARI.test(text);
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
/** Escaped text, marked as Hindi when it holds Devanagari. */
function words(tag: string, value: string, className?: string): string {
  const attributes = `${className ? ` class="${className}"` : ''}${hasDevanagari(value) ? ' lang="hi"' : ''}`;
  return `<${tag}${attributes}>${escapeHtml(value)}</${tag}>`;
}

const WIDTHS = Array.from({ length: 21 }, (_, index) => index * 5);
/** The report's only style: plain, readable, light and dark, Hindi-capable fonts first among the fallbacks. */
export const REPORT_STYLE = ':root{color-scheme:light dark;--bg:#ffffff;--fg:#16181b;--mute:#5c6168;--line:#e3e5e8;--bar:#3d7a5a}'
  + '@media (prefers-color-scheme:dark){:root{--bg:#111214;--fg:#eceef0;--mute:#9aa0a6;--line:#2a2d31;--bar:#6fbf93}}'
  + 'body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI","Nirmala UI","Noto Sans Devanagari","Kohinoor Devanagari",sans-serif}'
  + 'main{max-width:44rem;margin:0 auto;padding:2.5rem 1rem 4rem}h1{font-size:1.6rem;font-weight:600;margin:.25rem 0 .5rem}h2{font-size:1.15rem;font-weight:600;margin:2rem 0 .5rem}'
  + '.mute,.note,.src{color:var(--mute);font-size:13px;margin:0}.note{margin:-.5rem 0 1rem}p{margin:0 0 1rem}'
  + '.metric{border-top:1px solid var(--line);padding:.75rem 0}.value{font-size:1.5rem;font-weight:600;margin:0}.label{margin:0}'
  + '.bars{border-top:1px solid var(--line);padding:.75rem 0}.bar{display:grid;grid-template-columns:9rem 1fr auto;gap:.5rem;align-items:center;margin:.25rem 0}'
  + '.track{height:.6rem;background:var(--line);border-radius:3px}.fill{height:100%;background:var(--bar);border-radius:3px}'
  + WIDTHS.map(width => `.w${width}{width:${width}%}`).join('')
  + 'blockquote{margin:1rem 0;padding:.25rem 0 .25rem 1rem;border-left:3px solid var(--line)}footer{margin-top:3rem;border-top:1px solid var(--line);padding-top:1rem}'
  + '@media print{body{background:#fff;color:#000}main{max-width:none;padding:0}}';
const STYLE_HASH = btoa(String.fromCharCode(...sha256(utf8ToBytes(REPORT_STYLE))));
const CSP = `default-src 'none'; style-src 'sha256-${STYLE_HASH}'; img-src 'none'; form-action 'none'; base-uri 'none'`;

function block(item: ReportBlock): string {
  switch (item.kind) {
    case 'heading': return words('h2', item.text) + (item.estimate ? `<p class="note">${REPORT_WORDS.estimate}</p>` : '');
    case 'prose': return words('p', item.text) + (item.estimate ? `<p class="note">${REPORT_WORDS.estimate}</p>` : '');
    case 'metric':
      return `<div class="metric">${words('p', item.label, 'label')}${words('p', item.display, 'value')}`
        + `<p class="src">${REPORT_WORDS.receipt} ${escapeHtml(item.receiptId)}, ${escapeHtml(item.key)}</p></div>`;
    case 'bars':
      return `<div class="bars">${words('p', item.label, 'label')}${item.bars.map(bar => {
        const width = Math.min(100, Math.max(0, Math.round(bar.width / 5) * 5));
        return `<div class="bar">${words('span', bar.label)}<span class="track"><span class="fill w${width}"></span></span>${words('span', bar.display)}</div>`;
      }).join('')}<p class="src">${REPORT_WORDS.receipt} ${[...new Set(item.bars.map(bar => bar.receiptId))].map(escapeHtml).join(', ')}</p></div>`;
    case 'quote':
      return `<blockquote>${words('p', item.text)}${item.by ? words('p', item.by, 'mute') : ''}<p class="note">${REPORT_WORDS.asWritten}</p></blockquote>`;
  }
}

/** A share link a report may carry: an https address and nothing else. */
function safeLink(link: string | null | undefined): string | null {
  if (!link) return null;
  try { const url = new URL(link); return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null; } catch { return null; }
}

/** The report as one HTML file: the same document always gives the same text. */
export function renderReportHtml(doc: ReportDocument): string {
  const link = safeLink(doc.link);
  const body = `<p class="mute">${REPORT_WORDS.preparedBy} ${escapeHtml(doc.business)}. ${REPORT_WORDS.asOf} ${escapeHtml(doc.asOf)}.</p>`
    + words('h1', doc.title) + (doc.titleEstimate ? `<p class="note">${REPORT_WORDS.estimate}</p>` : '') + doc.blocks.map(block).join('')
    + `<footer><p class="mute">${REPORT_WORDS.footer}</p>${link ? `<p class="mute">${REPORT_WORDS.online} ${escapeHtml(link)}</p>` : ''}</footer>`;
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="robots" content="noindex, nofollow">`
    + `<title>${escapeHtml(doc.title)}</title><style>${REPORT_STYLE}</style></head><body><main>${body}</main></body></html>\n`;
}
