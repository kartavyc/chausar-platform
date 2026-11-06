// One-shot C4 task 16: words from inside Chausar that a client never reads. A receipt keeps its own labels ("Total:",
// "Price per month:") and a draft says the amount as words; a model that copies a label or names the calculator fails
// the faithfulness check, so it cannot pass. Each pattern is narrow on purpose: "please send your bills and receipts",
// "we will total the bills" and "the price per month is below" are a client's ordinary words and pass, and so is any of
// these words when the client's own message or files use it (an app that is a calculator).

const LABELS: readonly RegExp[] = [
  /(?<![\p{L}\p{N}])total:/iu,
  /(?<![\p{L}\p{N}])price per [\p{L}]+(?:, [^:\n]{1,40})?:/iu,
  /(?<![\p{L}\p{N}])calculator(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])receipt [A-Z]+-?\d[\w-]*/u,
  /(?<![\p{L}\p{N}])(?:price|work|calculator|sum|model) receipts?(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])(?:from|on|in|per|by|with) (?:a|an|the|its|this|that) receipt(?![\p{L}\p{N}])/iu,
];

/** The label a draft's own words copy, as they wrote it, or null. Words the client's own sources use stand. */
export function engineLabelIn(words: string, clientWords: readonly string[]): string | null {
  const theirs = clientWords.join('\n').toLowerCase();
  for (const pattern of LABELS) {
    const found = pattern.exec(words)?.[0];
    if (!found) continue;
    const word = /calculator/i.test(found) ? 'calculator' : /receipt/i.test(found) ? 'receipt' : null;
    if (word && theirs.includes(word)) continue;
    return found;
  }
  return null;
}

/** What the check says, in plain words. */
export const engineLabelLine = (label: string) => `This draft repeats words from inside Chausar: "${label}". Say it as the client would read it.`;
