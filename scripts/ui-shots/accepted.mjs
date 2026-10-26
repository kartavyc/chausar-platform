// Findings the walk lists rather than fails on: each one looked at, its reason written down, and the decision left to
// the integrator or the founder (WALK.md, "Listed, not fixed"). The walk still reports every one of them; it only
// stops them failing the run. Anything not matched here fails the walk.
//
// A finding matches when its axe rule (or problem text) matches and `when` says yes for the case and the page facts
// the walk recorded (`covered`: a sheet covers the phone screen).

// Wave 3 left none: the covering phone sheet became a modal dialog named by its title, and the business menu a labelled
// non-modal dialog (both found by this walk and fixed on 26 Oct). Add an entry only with the reason and the decision.
export const ACCEPTED = [];

/** The accepted entry a finding falls under, if any. */
export function acceptedFor(result, finding) {
  return ACCEPTED.find((entry) => entry.rules.includes(finding.id) && entry.when(result, finding));
}

/** The listed findings (scripts/ui-shots/accepted.mjs), one entry per reason, with where each showed. */
export function listedMd(report) {
  const byWhy = new Map();
  for (const r of report.results) {
    for (const v of r.listed ?? []) {
      const entry = byWhy.get(v.why) ?? { rules: new Set(), where: new Set() };
      entry.rules.add(v.id);
      entry.where.add(`${r.id} ${r.width}${r.theme === 'dark' ? ' dark' : ''}${r.hindi ? ' hi' : ''}`);
      byWhy.set(v.why, entry);
    }
  }
  if (!byWhy.size) return [];
  const lines = ['## Listed, not fixed', ''];
  for (const [why, { rules, where }] of byWhy) lines.push(`- axe ${[...rules].join(', ')} (${where.size} shots: ${[...where].slice(0, 6).join('; ')}${where.size > 6 ? '; ...' : ''}). ${why}`);
  lines.push('');
  return lines;
}
