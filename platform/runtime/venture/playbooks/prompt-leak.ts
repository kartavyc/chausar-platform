// Chausar playbooks: the prompt-leak lint (catalogue H20). Code only, no model. Words meant for the AI, not the reader,
// fail a draft before the owner sees it as ready: the model talking about itself ("as an AI"), a chat preamble that
// opens a line and ends in a colon ("Here is a post:", "Here's your caption:"), closers about the text itself ("I hope
// this helps", "let me know if you'd like another version", "feel free to tweak this"), placeholders a template left
// ("[hook]", "[insert link]", "<placeholder>", "{{name}}") and filler text. In the exact text of one post, a template
// label at the start of a line ("Hook:", "CTA:", "Version 2:") or a heading is a leak too; in a whole draft those
// labels are the package's own format. Each pattern is narrow on purpose: an honest AI label ("Made with AI"), "here's
// a thread on GST", "let me know if you need any other documents" or "Option A:" in a post all pass.
//
// Ideas taken, code written here: mrlong0129/yominpost (MIT), whose pre-post risk gate blocks a prompt-leak regex
// ("as an ai", "here is a post", "[hook]"); XuanRanL/loamwright-SEO-Skill (Apache-2.0), whose render lint fails a
// page with scaffold left in it.

export const PROMPT_LEAK_CHECK = 'prompt-leak';
export type PromptLeakKind = 'ai-self' | 'preamble' | 'placeholder' | 'scaffold';
export type PromptLeak = { kind: PromptLeakKind; phrase: string };

const APOS = "['’]";
/** What a chat preamble calls the text it hands over. */
const OUTPUTS = 'posts?|captions?|tweets?|versions?|rewrites?|replies|reply|emails?|scripts?|titles?|hooks?|variations?|bios?';
/** The start of a line, after an optional channel label ("X: "). A preamble counts only there. */
const LINE_START = '^[ \\t]*(?:[A-Za-z][A-Za-z ]{0,20}:[ \\t]*)?';
/** What a closer talks about: the text the model just wrote. */
const THE_TEXT = '(?:this|it|the (?:post|caption|draft|text|wording|tone))';

const LEAKS: readonly { kind: PromptLeakKind; pattern: RegExp }[] = [
  // The model talking about itself.
  { kind: 'ai-self', pattern: /\bas an ai\s*,/giu },
  { kind: 'ai-self', pattern: /\bas an ai (?:language )?model\b/giu },
  { kind: 'ai-self', pattern: /\bas an ai assistant\b/giu },
  { kind: 'ai-self', pattern: /\bas a (?:large )?language model\b/giu },
  { kind: 'ai-self', pattern: new RegExp(`\\bI${APOS}?(?:m| am) (?:just |only )?an ai (?:language model|assistant|model)\\b`, 'giu') },
  { kind: 'ai-self', pattern: /\bmy (?:knowledge|training) cut-?off\b/giu },
  { kind: 'ai-self', pattern: /एक एआई के रूप में|भाषा मॉडल के रूप में/gu },
  // A chat preamble that opens a line and hands over the text with a colon, and closers about that text.
  {
    kind: 'preamble',
    pattern: new RegExp(`${LINE_START}(?:(?:sure|certainly|of course|absolutely|okay|ok)[,!.]?[ \\t]*)?here(?:${APOS}s| is| are) (?:a|an|the|your|some|my|two|three|four|five|\\d+)[ \\t]+(?:[\\p{L}\\p{N}-]+[ \\t]+){0,2}?(?:${OUTPUTS})\\b[^:\\n]{0,60}:`, 'gimu'),
  },
  { kind: 'preamble', pattern: /\bi hope (?:this|that) helps\b/giu },
  { kind: 'preamble', pattern: new RegExp(`\\blet me know if (?:you${APOS}d like|you would like|you want|you need) (?:another|a different|a shorter|a longer|more|other) (?:version|variation|option|draft|take|caption|post|tweet|rewrite)s?\\b`, 'giu') },
  { kind: 'preamble', pattern: new RegExp(`\\blet me know if you(?:${APOS}d| would) like (?:any )?(?:changes|edits|tweaks|adjustments) to ${THE_TEXT}\\b`, 'giu') },
  { kind: 'preamble', pattern: new RegExp(`\\bfeel free to (?:adjust|edit|tweak|change|modify) ${THE_TEXT}\\b`, 'giu') },
  // Placeholders a template or the model left behind.
  { kind: 'placeholder', pattern: /\[(?:insert|add|your|client|brand|company|business|product|name|link|url|cta|hook|call to action|date|time|price|location|address|phone|email|hashtags?|emoji|image|photo|video|topic|placeholder|todo|x{2,})\b[^\]\n]{0,40}\]/giu },
  { kind: 'placeholder', pattern: /<(?:placeholder|insert[^<>\n]{0,40}|your[^<>\n]{0,40}|client[^<>\n]{0,40}|name|link|url|cta|hook)>/giu },
  { kind: 'placeholder', pattern: /\{\{[^{}\n]{1,40}\}\}/gu },
  { kind: 'placeholder', pattern: /\b(?:TODO|FIXME)\b/gu },
  { kind: 'placeholder', pattern: /\blorem ipsum\b/giu },
];

/**
 * Template labels at the start of a line, and headings: leaks only in the exact text of one post. Labels a real post
 * may carry ("Option A:", "Part 2:", "Body:") are not here.
 */
const POST_SCAFFOLD: readonly RegExp[] = [
  /^[ \t]*(?:\*\*|__)?(?:hook|cta|call to action|caption|hashtags|subject line|(?:post|version|variation|tweet|draft) (?:\d{1,2}|[a-e]))(?:\*\*|__)?[ \t]*:/gimu,
  /^[ \t]*#{1,6}[ \t]+[^\n]{0,30}/gmu,
];

/**
 * Every leak in a text, in order of where it starts, one per place. scope 'post' is the exact text of one post:
 * template labels and headings count there too.
 */
export function promptLeaks(text: string, scope: 'draft' | 'post' = 'draft'): PromptLeak[] {
  const found: { at: number; leak: PromptLeak }[] = [];
  const seen = new Set<number>();
  const scan = (pattern: RegExp, kind: PromptLeakKind) => {
    for (const match of text.matchAll(pattern)) {
      if (seen.has(match.index!)) continue;
      seen.add(match.index!);
      found.push({ at: match.index!, leak: { kind, phrase: match[0].trim() } });
    }
  };
  for (const item of LEAKS) scan(item.pattern, item.kind);
  if (scope === 'post') for (const pattern of POST_SCAFFOLD) scan(pattern, 'scaffold');
  return found.sort((a, b) => a.at - b.at).map(item => item.leak);
}

/** One plain line for the owner naming what leaked (at most three phrases), or null when nothing did. */
export function promptLeakLine(leaks: readonly PromptLeak[], what: 'draft' | 'post' = 'draft'): string | null {
  if (!leaks.length) return null;
  const named = [...new Set(leaks.map(item => item.phrase))].slice(0, 3).map(phrase => `"${phrase}"`).join(', ');
  return `The ${what} still has words meant for the AI, not the reader: ${named}. Remove them before it goes out.`;
}
