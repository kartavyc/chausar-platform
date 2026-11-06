// Original Chausar source inventory. Inspired by catalogue S2 repurposing; no outside code.
export type InventoryKind = 'claims' | 'numbers' | 'stories' | 'mistakes' | 'quotes';
export type InventoryItem = {
    kind: InventoryKind;
    text: string;
    from: number;
    to: number;
    numbers: string[];
};
export type SourceInventory = {
    items: InventoryItem[];
    counts: Record<InventoryKind | 'total', number>;
};
const PREFIXES: readonly [
    InventoryKind,
    RegExp
][] = [
    ['claims', /^(?:claim|fact|दावा|तथ्य)\s*:/iu],
    ['numbers', /^(?:number|figure|संख्या|आंकड़ा|आँकड़ा)\s*:/iu],
    ['stories', /^(?:story|कहानी)\s*:/iu],
    ['mistakes', /^(?:mistake|lesson|गलती|सीख)\s*:/iu],
    ['quotes', /^(?:quote|उद्धरण)\s*:/iu],
];
/** Keep exact source spans and count repeated lines only once; nothing is added to the source. */
export function sourceInventory(source: string): SourceInventory {
    if (typeof source !== 'string' || source.length > 100000)
        throw Object.assign(new Error('Use a source of at most 100,000 characters.'), { code: 'SOCIAL_SOURCE_INVALID' });
    const counts: SourceInventory['counts'] = { claims: 0, numbers: 0, stories: 0, mistakes: 0, quotes: 0, total: 0 };
    const items: InventoryItem[] = [], seen = new Set<string>();
    for (const match of source.matchAll(/[^\r\n]+/gu)) {
        const text = match[0].trim();
        if (!text || PREFIXES.some(([, pattern]) => pattern.test(text) && !text.replace(pattern, '').trim()))
            continue;
        const key = text.normalize('NFKC').toLocaleLowerCase('en-IN').replace(/\s+/gu, ' ');
        if (seen.has(key))
            continue;
        seen.add(key);
        const kind = PREFIXES.find(([, pattern]) => pattern.test(text))?.[0]
            ?? (/["“][^"”]+["”]/u.test(text) ? 'quotes' : /\p{N}/u.test(text) ? 'numbers' : 'claims');
        const from = match.index + match[0].indexOf(text);
        items.push({ kind, text, from, to: from + text.length, numbers: [...text.matchAll(/\p{N}+(?:[.,]\p{N}+)*/gu)].map(value => value[0]) });
        counts[kind] += 1;
        counts.total += 1;
    }
    return { items, counts };
}
