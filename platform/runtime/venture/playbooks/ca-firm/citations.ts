// CA2: dated citation rules, inspired by korean-tax-agent (MIT), implemented independently.
// Primary sections checked on 27 October 2026 against the Income Tax Department's 2026 text.
import { check, type Context, type State } from '../../../contracts.ts';
import type { VentureDeps } from '../../contracts.ts';
import { digest, exactPayload, listRecords, requireAppChannel, ventureAction } from '../../records.ts';
import { ITR_YEARS, ITR_SOURCES } from './itr-forms.ts';
import { caOfRecord } from './signoff.ts';
import { isoDate } from './money.ts';
export type CitationRow = {
    id: string;
    act: '1961' | '2025';
    section: string;
    title: string;
    validFrom: string;
    validTo: string;
    replacedBy: string | null;
    source: string;
    verification: string;
};
export type CitationConfirmation = {
    name: string;
    membershipNumber: string;
    at: string;
};
export type CitationUse = {
    mode: 'rehearsal' | 'client';
    confirmedBy: CitationConfirmation | null;
};
const pairs = [
    ['80C', '123', 'Life insurance, provident fund and eligible payments', 'https://www.incometaxindia.gov.in/w/section-123-96'],
    ['44AD', '58', 'Presumptive business income, subsection 2 table row 1', 'https://www.incometaxindia.gov.in/w/section-58-144'],
    ['44ADA', '58', 'Presumptive professional income, subsection 2 table row 3', 'https://www.incometaxindia.gov.in/w/section-58-144'],
    ['194J', '393', 'Professional fees, subsection 1 table row 6(iii)', 'https://www.incometaxindia.gov.in/w/section-393-6'],
] as const;
export const CITATION_TABLE = Object.freeze({ version: 1, confirmedBy: null, rules: [...ITR_YEARS.map(row => ({ ...row, id: 'itr-' + row.assessmentYear, title: 'ITR eligibility and regime switching', source: ITR_SOURCES.itr4 })), ...['2026-27', '2027-28'].map((assessmentYear, index) => ({ id: 'advance-' + assessmentYear, assessmentYear, validFrom: (2025 + index) + '-04-01', validTo: (2026 + index) + '-03-31', title: 'Advance tax: June 15%, September 45%, December 75%, March 100%; eligible presumptive cases March 100%', verification: 'Official advance-tax FAQ checked on 27 October 2026. The CA separately confirms the dated instalment and section table in rate confirmations.', source: 'https://www.incometaxindia.gov.in/documents/d/guest/faq-on-advance-tax' }))], rows: Object.freeze(pairs.flatMap(([old, current, title, source]) => [
        { id: 'ita1961-' + old, act: '1961' as const, section: old, title, validFrom: '1962-04-01', validTo: '2026-03-31', replacedBy: current, source, verification: 'Corresponding provision checked against official 2026 text; CA confirms applicability.' },
        { id: 'ita2025-' + current + '-' + old, act: '2025' as const, section: current, title, validFrom: '2026-04-01', validTo: '2027-03-31', replacedBy: null, source, verification: 'Official 2026 text checked; CA confirms applicability.' },
    ])) });
export const citationTableHash = () => digest(CITATION_TABLE);
/** Current exact version confirmation, never a confirmation of some older table. */
export function citationUseFor(state: State, ventureId: string, mode: CitationUse['mode']): CitationUse {
    const saved = listRecords(state, 'venture-ca-citations', ventureId).filter(row => row.version === CITATION_TABLE.version && row.tableHash === citationTableHash()).at(-1);
    return { mode, confirmedBy: saved?.confirmedBy ?? null };
}
/** Confirming is an explicit app action by the named CA and binds the entire current table. */
export async function caConfirmCitations(deps: VentureDeps, ctx: Context, payload: unknown) {
    requireAppChannel(ctx, 'venture.ca.confirmCitations');
    const p = exactPayload(payload, ['version', 'membershipNo'], ['version', 'membershipNo']);
    check(p.version === CITATION_TABLE.version, 'CITATIONS_STALE', 'Review the current citations table before confirming it.');
    return ventureAction(deps, ctx, 'approve', 'ca.citations.confirm', tx => {
        const ca = caOfRecord(tx.state, tx.venture!.id);
        check(ca, 'CA_OF_RECORD_REQUIRED', 'Name your CA of record first.');
        check(typeof p.membershipNo === 'string' && p.membershipNo.replace(/\s+/g, '') === ca.membershipNumber, 'CA_NOT_OF_RECORD', 'Only your CA of record confirms this table.');
        const confirmedBy = { name: ca.name, membershipNumber: ca.membershipNumber, at: tx.now };
        tx.put({ ...tx.base('venture-ca-citations'), version: CITATION_TABLE.version, tableHash: citationTableHash(), confirmedBy });
        return { version: CITATION_TABLE.version, tableHash: citationTableHash(), confirmedBy };
    });
}
/** Validate each citation against an explicit dated row. A mapping note names both numbers and the new Act. */
export function checkCitations(input: {
    draft: string;
    incomeDate: string;
}, use: CitationUse) {
    check(typeof input.draft === 'string' && input.draft.length <= 100000, 'CITATIONS_INVALID', 'Send a bounded draft to check.');
    isoDate(input.incomeDate, 'Income date');
    check(use.mode === 'rehearsal' || use.confirmedBy, 'CITATIONS_UNCONFIRMED', 'Your CA must confirm the current citations table before client work.');
    const references = citationReferences(input.draft);
    const findings = references.map(ref => {
        const before = input.draft.slice(Math.max(0, ref.index - 60), ref.index).split(/[;\n.]/).at(-1)!, after = input.draft.slice(ref.index, ref.index + 100).split(/[;\n.]/)[0];
        const explicit2025 = !ref.bare && (/Act\s*,?\s*2025/i.test(before) || /Act\s*,?\s*2025/i.test(after));
        const explicit1961 = ref.bare || (/Act\s*,?\s*1961/i.test(before) || /Act\s*,?\s*1961/i.test(after));
        const candidates = CITATION_TABLE.rows.filter(row => row.section === ref.section && (!explicit2025 || row.act === '2025') && (!explicit1961 || row.act === '1961'));
        const current = candidates.find(row => row.validFrom <= input.incomeDate && row.validTo >= input.incomeDate);
        if (current)
            return { section: ref.section, passed: true, sourceId: current.id, detail: 'Dated section found in the confirmed rule register.' };
        const old = candidates.find(row => row.act === '1961' && row.replacedBy && input.incomeDate > row.validTo);
        const note = old && input.draft.split(/[;\n.]/).some(line => /\b(?:mapping|renumber|replaced|correspond|note)\b|->/i.test(line) && line.includes(old.section) && line.indexOf(old.section) < line.search(/Act\s*,?\s*2025/i) && new RegExp('Act\\s*,?\\s*2025\\s+section\\s+' + old.replacedBy + '\\b', 'i').test(line));
        if (old && note && input.incomeDate <= '2027-03-31')
            return { section: ref.section, passed: true, sourceId: old.id, detail: 'The draft includes the corresponding 2025 Act section note.' };
        return { section: ref.section, passed: false, sourceId: old?.id ?? null, detail: old ? 'Add a mapping note from ' + old.section + ' to Income-tax Act 2025 section ' + old.replacedBy + '.' : 'Chausar could not check section ' + ref.section + '. Your CA must confirm it.' };
    });
    return { passed: findings.every(row => row.passed), findings, version: CITATION_TABLE.version, tableHash: citationTableHash(), confirmedBy: use.confirmedBy, rehearsal: use.mode === 'rehearsal' };
}
/** One parser shared by the final draft gate and the dated citation checker. */
export function citationReferences(draft: string) {
    const input = { draft: draft.replace(/\[source:[^\]\r\n]+\]/g, match => ' '.repeat(match.length)) };
    const pattern = /\b(?:sections?|sec\.?|u\s*\/\s*s)\s*(\d+[a-z]*(?:\s*\([^)]{1,20}\))*)/gi;
    const explicit = [...input.draft.matchAll(pattern)];
    const references = explicit.map(match => ({ section: match[1].replace(/\s/g, '').toUpperCase(), index: match.index!, bare: false }));
    for (const ref of explicit) {
        let offset = ref.index! + ref[0].length;
        const range = /^\s*(?:to|-)\s*(\d+[a-z]*)/i.exec(input.draft.slice(offset));
        if (range)
            references.push({ section: ref[1] + '-' + range[1], index: offset, bare: false });
        for (;;) {
            const tail = /^\s*(?:,\s*(?:and\s+|or\s+)?|(?:and|or|&)\s+)(\d+[a-z]*(?:\s*\([^)]{1,20}\))*)/i.exec(input.draft.slice(offset));
            if (!tail)
                break;
            const index = offset + tail[0].indexOf(tail[1]);
            references.push({ section: tail[1].replace(/\s/g, '').toUpperCase(), index, bare: false });
            offset += tail[0].length;
        }
    }
    const bare = /\b(80(?:C|CCD|CCC|D|DD|DDB|E|EE|EEA|EEB|G|GG|GGA|GGC|TTA|TTB|U)(?:\([0-9A-Za-z]{1,4}\))?|87A|115BAC|234[ABC]|44ADA|44AD|44AE|139\(\d\)|194[A-Z]{0,2}|206AA|288[AB])\b/gi;
    for (const match of input.draft.matchAll(bare))
        if (!explicit.some(ref => match.index! >= ref.index! && match.index! < ref.index! + ref[0].length) && !references.some(ref => ref.index === match.index))
            references.push({ section: match[1].toUpperCase(), index: match.index!, bare: true });
    references.sort((a, b) => a.index - b.index);
    return references;
}
