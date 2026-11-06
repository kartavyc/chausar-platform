// CA7 fact-check form. korean-tax-agent (MIT) supplied the format; original validation, no copied code.
import type { Deliverable } from '../../contracts.ts';
export type TaxQuestionNote = {
    supports: {
        claim: string;
        sourceIds: string[];
    }[];
    conflicts: {
        claim: string;
        sourceIds: string[];
    }[];
    unknowns: string[];
    coverage: string;
};
/** All positive and conflicting claims need a source from this order or the confirmed citation table. */
export function checkQuestionNote(note: TaxQuestionNote, sourceIds: readonly string[]) {
    const problems: string[] = [];
    const allowed = new Set(sourceIds);
    if (!Array.isArray(note.supports) || !Array.isArray(note.conflicts) || !Array.isArray(note.unknowns) || typeof note.coverage !== 'string' || !note.coverage.trim())
        return { passed: false, problems: ['Use Supports, Conflicts, Unknowns and Coverage.'] };
    for (const item of [...note.supports, ...note.conflicts])
        if (typeof item.claim !== 'string' || !item.claim.trim() || !Array.isArray(item.sourceIds) || !item.sourceIds.length || item.sourceIds.some(id => !allowed.has(id)))
            problems.push('Every claim must cite a known law upload or citation-table source id.');
    if (note.unknowns.some(line => typeof line !== 'string' || !line.trim()))
        problems.push('State each unknown in plain words.');
    if (!note.supports.length && !note.conflicts.length && !note.unknowns.length)
        problems.push('State the evidence or what facts are missing.');
    return { passed: problems.length === 0, problems };
}
/** Rendered note headings are mandatory; each factual text paragraph carries [source:ID]. */
export function questionNoteFromDraft(draft: Deliverable, sourceIds: readonly string[]) {
    const missing = ['Supports', 'Conflicts', 'Unknowns', 'Coverage'].filter(title => !draft.sections.some(section => section.heading.toLowerCase() === title.toLowerCase()));
    if (missing.length)
        return { passed: false, problems: ['Missing fact-check sections: ' + missing.join(', ') + '.'] };
    const lines = (name: string) => draft.sections.filter(section => section.heading.toLowerCase() === name.toLowerCase()).flatMap(section => section.parts.flatMap(part => part.kind === 'text' ? [part.text] : []));
    const claims = (name: string) => lines(name).filter(line => !/^\s*(?:none|none found)\.?\s*$/i.test(line)).map(claim => ({ claim, sourceIds: [...claim.matchAll(/\[source:([A-Za-z0-9_.:-]+)\]/g)].map(match => match[1]) }));
    return checkQuestionNote({ supports: claims('Supports'), conflicts: claims('Conflicts'), unknowns: lines('Unknowns'), coverage: lines('Coverage').join(' ') }, sourceIds);
}
