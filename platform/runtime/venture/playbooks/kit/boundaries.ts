// Chausar playbook kit: the measurement-boundaries table (Ink v2 wave 5, package 5A3; catalogue P6). Each playbook says,
// for each kind of evidence it reads, what that evidence can say and what it cannot: "a JSON-LD block parsed" says the
// page carries structured data, not that it is eligible for rich results. Business > Plan and playbook shows the table
// (venture.rules.list), so neither the owner nor the team claims more than the evidence holds. Code only.
//
// Idea taken, code written here: beyondseo references/measurement-boundaries.md (what each SEO measurement can and
// cannot show), read for the idea only.
import { check } from '../../../contracts.ts';
import type { BoundaryView } from '../../contracts.ts';
import type { KitBoundary } from './define.ts';

const filled = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/**
 * Refuses (BOUNDARY_INVALID) a playbook with no row, a row without its evidence, what it can say or what it cannot say,
 * or the same evidence listed twice. Returns the rows as given.
 */
export function validateBoundaries(boundaries: readonly KitBoundary[]): readonly KitBoundary[] {
  check(boundaries.length > 0, 'BOUNDARY_INVALID', 'A playbook needs at least one row in its measurement-boundaries table.');
  const seen = new Set<string>();
  for (const row of boundaries) {
    check(filled(row?.evidence), 'BOUNDARY_INVALID', 'Each measurement-boundaries row needs its evidence.');
    check(filled(row.canSay) && filled(row.cannotSay), 'BOUNDARY_INVALID', `${row.evidence} needs what it can say and what it cannot.`);
    check(!seen.has(row.evidence), 'BOUNDARY_INVALID', `${row.evidence} is listed twice.`);
    seen.add(row.evidence);
  }
  return boundaries;
}

/** The table as Plan and playbook shows it, word for word. */
export function boundaryViews(boundaries: readonly KitBoundary[]): BoundaryView[] {
  return boundaries.map(row => ({ evidence: row.evidence, canSay: row.canSay, cannotSay: row.cannotSay }));
}
