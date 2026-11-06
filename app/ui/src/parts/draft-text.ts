/**
 * One-shot C4 task 14: a draft's Markdown as the owner reads it. Pure. `toSections` gives the title and each `##`
 * section as plain text (list items as lines starting "• ", bold and italic marks dropped); `fromSections` writes the
 * same Markdown back; `toPlainMessage` is the message the client gets, for the draft sheet and Copy. Anything the
 * simple editor could not write back as it found it (a table, a link, an image, a nested list) answers null, and the
 * editor shows the whole text in one box.
 */

import { TEMPLATE_OUTLINE_LINE } from '../../../../platform/runtime/venture/delivery/template-outline';

export interface DraftSection {
  heading: string;
  text: string;
  /** A blank line between the heading and its words, when the draft had one, so it is written back the same. */
  gap?: true;
}

export interface DraftSections {
  /** Words before the title or the first section: the engine's line on a template outline, or a draft's opening. */
  opening: string | null;
  title: string | null;
  sections: DraftSection[];
}

const BULLET = '• ';

/** What the simple editor can't keep: a table, a link, an image, a nested list, a quote, code, a rule, a deeper heading. */
const CANT_KEEP = [
  /^\s*\|/m,
  /\|\s*:?-{3,}/,
  /!?\[[^\]\n]*\]\([^)\n]*\)/,
  /^[ \t]+(?:[-*+]|\d+[.)])\s/m,
  /^[*+] /m,
  /^>/m,
  /^```/m,
  /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/m,
  /^#{3,}\s/m,
];

/** Bold and italic marks dropped; a star between spaces ("2 * 3") is no mark. */
function dropMarks(text: string): string {
  return text
    .replace(/\*\*(\S(?:[^*\n]*\S)?)\*\*/g, '$1')
    .replace(/(?<![\w])__(\S(?:[^_\n]*\S)?)__(?![\w])/g, '$1')
    .replace(/(?<![\w*])\*(\S(?:[^*\n]*\S)?)\*(?![\w*])/g, '$1')
    .replace(/(?<![\w])_(\S(?:[^_\n]*\S)?)_(?![\w])/g, '$1');
}

const toBullets = (text: string) => text.replace(/^- /gm, BULLET);
const fromBullets = (text: string) => text.replace(/^• /gm, '- ');

/** The draft as a title and sections, or null when the simple editor could not write it back. */
export function toSections(markdown: string): DraftSections | null {
  if (markdown.includes('\r') || CANT_KEEP.some((pattern) => pattern.test(markdown))) return null;
  const plain = dropMarks(markdown);
  const doc: DraftSections = { opening: null, title: null, sections: [] };
  const lines = plain.split('\n');
  const opening: string[] = [];
  let current: { heading: string; lines: string[] } | null = null;
  const close = () => {
    if (!current) return;
    const gap = current.lines[0] === '';
    const text = current.lines.slice(gap ? 1 : 0).join('\n').replace(/\n+$/, '');
    doc.sections.push({ heading: current.heading, text: toBullets(text), ...(gap && text ? { gap: true as const } : {}) });
    current = null;
  };
  for (const line of lines) {
    if (line.startsWith('## ')) {
      close();
      current = { heading: line.slice(3), lines: [] };
    } else if (line.startsWith('# ') && !current && doc.title === null) {
      doc.title = line.slice(2);
    } else if (current) {
      current.lines.push(line);
    } else {
      opening.push(line);
    }
  }
  close();
  const said = opening.join('\n').replace(/^\n+|\n+$/g, '');
  if (said) doc.opening = toBullets(said);
  // Whatever else this draft holds: written back, it must read exactly as it did (marks apart), or it stays one box.
  return fromSections(doc) === plain ? doc : null;
}

/** The sections as the Markdown the engine keeps. */
export function fromSections(doc: DraftSections): string {
  const blocks: string[] = [];
  if (doc.opening !== null) blocks.push(fromBullets(doc.opening));
  if (doc.title !== null) blocks.push(`# ${doc.title}`);
  for (const section of doc.sections) {
    const text = fromBullets(section.text);
    blocks.push(text ? `## ${section.heading}\n${section.gap ? '\n' : ''}${text}` : `## ${section.heading}`);
  }
  return blocks.join('\n\n');
}

/** A sign-off left at the end of a paragraph ("... next week. Regards, Asha") goes on its own line. */
const SIGN_OFF = /([.!?])[ \t]+((?:kind regards|warm regards|best regards|regards|best wishes|best|thanks|thank you|sincerely|cheers|yours),?[ \t]*[^\n.!?,]{0,60})$/i;

/**
 * The message as the client gets it: no Markdown marks, each heading a plain line, list items with a bullet, the
 * paragraphs as written, the sign-off on its own line, and without the engine's line for the owner on a template
 * outline (the draft sheet says that one above the message).
 */
export function toPlainMessage(markdown: string): string {
  const text = markdown.replace(/\r\n/g, '\n');
  const body = text.startsWith(TEMPLATE_OUTLINE_LINE) ? text.slice(TEMPLATE_OUTLINE_LINE.length).replace(/^\n+/, '') : text;
  const plain = dropMarks(body)
    .replace(/^#{1,6} +/gm, '')
    .replace(/^[ \t]*[-*+] +/gm, BULLET)
    .replace(/^> ?/gm, '')
    .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/\[([^\]\n]*)\]\(([^)\n]*)\)/g, '$1 ($2)')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\s+$/, '');
  return plain.replace(SIGN_OFF, (_, stop: string, words: string) => (/,/.test(words) ? `${stop}\n\n${words}` : `${stop} ${words}`));
}

/** The engine's line for the owner at the head of a template outline, when this draft has one. */
export function ownerLineOf(markdown: string): string | null {
  return markdown.startsWith(TEMPLATE_OUTLINE_LINE) ? TEMPLATE_OUTLINE_LINE : null;
}
