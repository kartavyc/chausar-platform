// Chausar delivery (Ink v2 wave 4, package 4J2; catalogue O6): the three-snapshot merge by paragraph. When the agent's
// revision of a draft lands, the text it revised (the base), the owner's version and the agent's new version are split
// into paragraphs and lined up by their longest common run (a diff3 over paragraphs, written here). Between paragraphs
// all three share, each stretch is decided by code: only the agent changed it, the agent's words are taken; only the
// owner changed it, the owner's stay; both changed it the same way, it stays; both changed it differently, the owner's
// stay and the agent's are listed as a suggestion for the owner to take or drop. An automatic pass never overwrites
// the owner's own words. Nothing here calls a model.
import type { DraftChangeView, DraftMergePart } from '../contracts.ts';
import { digest } from '../records.ts';

/** A text as its paragraphs: blocks between blank lines, line ends made plain, empty blocks left out. */
export function paragraphs(text: string | null | undefined): string[] {
  return String(text ?? '').replace(/\r\n/g, '\n').split(/\n[ \t]*\n+/).map(part => part.replace(/^\n+|\s+$/g, '')).filter(part => part.length > 0);
}

/** Paragraphs back into one text, a blank line between each. */
export function joinParagraphs(list: readonly string[]): string {
  return list.join('\n\n');
}

/** The pairs (a index, b index) of a longest common run of equal paragraphs, in order. */
function commonRun(a: readonly string[], b: readonly string[]): [number, number][] {
  const rows = a.length + 1, cols = b.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = a[i] === b[j] ? table[(i + 1) * cols + j + 1] + 1 : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { pairs.push([i, j]); i += 1; j += 1; }
    else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) i += 1;
    else j += 1;
  }
  return pairs;
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((item, index) => item === b[index]);

/**
 * The merge of the owner's and the agent's versions of one base, as parts: stretches all three share, and each changed
 * stretch with the owner's and the agent's paragraphs. An agent-only stretch is taken; a stretch both changed in
 * different ways is open (the owner's stay until the owner takes the agent's). A stretch only the owner changed, or
 * both changed the same way, is the owner's own and not listed as a change.
 */
export function mergeParagraphs(base: string, owner: string, agent: string): DraftMergePart[] {
  const b = paragraphs(base), o = paragraphs(owner), t = paragraphs(agent);
  const toOwner = new Map(commonRun(b, o));
  const toAgent = new Map(commonRun(b, t));
  const parts: DraftMergePart[] = [];
  const keep = (text: readonly string[]) => {
    if (!text.length) return;
    const last = parts[parts.length - 1];
    if (last?.kind === 'same') last.text.push(...text);
    else parts.push({ kind: 'same', text: [...text] });
  };
  const stretch = (bs: string[], os: string[], ts: string[]) => {
    if (!bs.length && !os.length && !ts.length) return;
    // Paragraphs edited in place (the same count in all three) are decided one by one, paragraph by paragraph.
    if (bs.length > 1 && os.length === bs.length && ts.length === bs.length) {
      bs.forEach((paragraph, index) => stretch([paragraph], [os[index]], [ts[index]]));
      return;
    }
    if (same(os, bs) && !same(ts, bs)) parts.push(change(parts.length, os, ts, 'agent'));
    else if (same(ts, bs) || same(os, ts)) keep(os);
    else parts.push(change(parts.length, os, ts, 'both'));
  };
  let i = 0, j = 0, k = 0;
  for (let at = 0; at < b.length; at += 1) {
    const jo = toOwner.get(at), kt = toAgent.get(at);
    // A base paragraph both versions kept, after the last one they shared: the stretch before it, then the paragraph.
    if (jo === undefined || kt === undefined || jo < j || kt < k) continue;
    stretch(b.slice(i, at), o.slice(j, jo), t.slice(k, kt));
    keep([b[at]]);
    i = at + 1; j = jo + 1; k = kt + 1;
  }
  stretch(b.slice(i), o.slice(j), t.slice(k));
  return parts;
}

function change(index: number, owner: string[], agent: string[], by: 'agent' | 'both'): DraftMergePart {
  return { kind: 'change', id: `chg_${digest({ index, owner, agent }).slice(0, 16)}`, owner, agent, by, status: by === 'agent' ? 'taken' : 'open' };
}

/** The merged text: each stretch all three share, then each change as decided (taken: the agent's; open or dropped: the owner's). */
export function mergedText(parts: readonly DraftMergePart[]): string {
  return joinParagraphs(parts.flatMap(part => (part.kind === 'same' ? part.text : part.status === 'taken' ? part.agent : part.owner)));
}

/** Each change as the screens read it: where it starts in the merged text, the owner's words and the agent's. */
export function changeViews(parts: readonly DraftMergePart[]): DraftChangeView[] {
  const views: DraftChangeView[] = [];
  let paragraph = 0;
  for (const part of parts) {
    if (part.kind === 'same') { paragraph += part.text.length; continue; }
    views.push({ id: part.id, paragraph, before: joinParagraphs(part.owner), after: joinParagraphs(part.agent), by: 'agent', status: part.status });
    paragraph += (part.status === 'taken' ? part.agent : part.owner).length;
  }
  return views;
}
