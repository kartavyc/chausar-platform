// Original Chausar seven-day hook check, shared by live approval and rehearsal.
export {};
function check(condition:unknown,code:string,message:string):asserts condition { if(!condition)throw Object.assign(new Error(message),{code}); }
/** A formula may be used again only after seven full days; future history never passes silently. */
export function hookVariety(formula: string, history: readonly {
    formula: string;
    at: string;
}[], now: string): {
    passed: boolean;
    check: 'hook-variety';
    line: string;
} {
    const at = Date.parse(now);
    check(formula.trim().length > 0 && formula.length <= 80 && history.length <= 1000 && Number.isFinite(at), 'SOCIAL_SOURCE_INVALID', 'Give a hook formula and a valid time.');
    const key = formula.trim().normalize('NFKC').toLocaleLowerCase('en-IN');
    const repeated = history.some(item => {
        const prior = Date.parse(item.at);
        check(Number.isFinite(prior), 'SOCIAL_SOURCE_INVALID', 'The hook history needs a valid time.');
        return item.formula.trim().normalize('NFKC').toLocaleLowerCase('en-IN') === key && at - prior < 7 * 86400000;
    });
    return { passed: !repeated, check: 'hook-variety', line: repeated ? 'Use a different hook formula this week.' : 'This hook formula was not used in the past seven days.' };
}
