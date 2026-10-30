import type {DraftTimes} from '../delivery/deliverable.ts';
import { assertNoMoney, assertNoNumbers, copiedTokens } from '../records.ts';

export function checkJobDraftNumbers(raw: unknown, source: string, calculatedTimes?:DraftTimes|null): { id: string; text: string }[] {
  const draft = raw as { title?: unknown; sections?: { heading?: unknown; parts?: { kind?: unknown; text?: unknown }[] }[]; questionsForClient?: unknown[] };
  const allowed = copiedTokens(source);
  const structural: { id: string; text: string }[] = [];
  // Only exact count-and-noun phrases are source evidence. A bare copied number can become a different claim.
  const counts = new Set([...source.matchAll(/\b\d{1,9}\s+[\p{L}][\p{L}-]{1,40}\b/gu)].map(match => match[0].toLowerCase().replace(/\s+/g, ' ')));
  const times = new Set([...source.matchAll(/\b(?:chapters?|timestamps?)\b[^.!?\n]{0,300}/gi)].flatMap(segment => [...segment[0].matchAll(/\b\d{1,3}:[0-5]\d(?::[0-5]\d)?\b/g)].map(match => match[0])));
  const verify = (value: unknown, heading = '', ordinal?: number) => {
    if (typeof value !== 'string') return; // The closed draft validator reports malformed fields.
    // Copying a currency code from the owner cannot exempt a neighbouring amount.
    assertNoMoney(value, 'draft text');
    assertNoNumbers(value.replace(/\p{Nd}/gu, ''), 'draft text', allowed);
    let words = value;
    if (heading === 'Post plan' && ordinal !== undefined) words = words.replace(new RegExp(`^Post ${ordinal} \\|`), () => { structural.push({ id: `post-position.${ordinal}`, text: `Post ${ordinal}` }); return 'Post |'; });
    if (heading === 'Chapters' || heading === 'Description and chapters') words = words.replace(/^(\d{1,3}:[0-5]\d(?::[0-5]\d)?)\s+/, (whole, time: string) => (times.has(time)||(calculatedTimes?.heading===heading&&calculatedTimes.codes.includes(time))) ? '' : whole);
    words = words.replace(/\b\d{1,9}\s+[\p{L}][\p{L}-]{1,40}\b/gu, phrase => !/\s(?:per|basis|bps|rate|rates)\b/i.test(phrase) && counts.has(phrase.toLowerCase().replace(/\s+/g, ' ')) ? 'source count' : phrase);
    assertNoNumbers(words, 'draft text', allowed);
  };
  verify(draft?.title);
  if (Array.isArray(draft?.sections)) for (const section of draft.sections) if (Array.isArray(section?.parts)) {
    section.parts.forEach((part, index) => { if (part?.kind === 'text') verify(part.text, typeof section.heading === 'string' ? section.heading : '', index + 1); });
  }
  if (Array.isArray(draft?.questionsForClient)) draft.questionsForClient.forEach(value => verify(value));
  return structural;
}
