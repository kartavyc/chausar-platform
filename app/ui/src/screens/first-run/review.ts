/**
 * The review of one starter pack: pure data and pure transitions, no I/O.
 *
 * Rules kept here.
 * - The setup guide proposes and never accepts. A row becomes accepted only through
 *   `acceptRow`, which the screen calls from a person's Accept click. Nothing here is
 *   called from an effect, a mount, a selection or a callback of the Engine.
 * - Every review has a `generation`: a token unique to one selection of one pack. Two
 *   reviews of the same pack, even with identical bytes, have different generations.
 *   Every review has a `revision`: the generation plus the number of saved edits, so a
 *   control rendered before an edit names a revision that no longer exists.
 * - An intent names the review it was rendered for. Accept names the revision and the
 *   content digest; an edit names the revision; a pin that does not match the current
 *   review is refused and changes nothing. An old control can never reach a new review.
 * - An acceptance pins the exact JSON of the definition it accepted. The settings
 *   acceptance pins the exact JSON of the proposed pack, label, currency, GST mode and
 *   fields. A pin that no longer equals the current text is not an acceptance.
 * - A changed meaning is a plain-language edit only: name, label, kind, field, currency,
 *   null rule and sign stay as proposed. The row's acceptance is cleared, the review
 *   digest is cleared until the whole draft is hashed again, the revision moves on, and
 *   the original Engine text is kept beside the change.
 * - `allReviewed` is the only thing that makes Publish available: every definition
 *   accepted with a current pin, the settings accepted with a current pin, and a review
 *   digest present for the exact current draft.
 * - Choosing a pack again starts a new review: every decision, including the settings
 *   acceptance, is gone, and the generation is new.
 */

import type { Definition, DictionaryDraft } from './contracts.ts';
import { withMeaning } from './contracts.ts';
import { definitionJson, draftJson, settingsJson } from './digest.ts';

export const SETTINGS_ROW = 'settings';

export type RowStatus = 'proposed' | 'changed' | 'accepted';

export interface ReviewRow {
  /** The current definition in the frozen draft. */
  readonly definition: Definition;
  /** The meaning exactly as the Engine's pack proposed it. */
  readonly proposed: string;
  readonly status: RowStatus;
  /** The exact definition JSON the person accepted, or null. */
  readonly pin: string | null;
}

export interface SettingsReview {
  readonly accepted: boolean;
  /** The exact settings JSON the person accepted, or null. */
  readonly pin: string | null;
}

/** What a rendered Accept or Publish control names: the exact review revision it was drawn for and the content digest it saw. */
export interface ReviewPin {
  readonly revision: string;
  readonly digest: string;
}

export interface Review {
  /** Unique to one selection of one pack. */
  readonly generation: string;
  /** `generation` plus the count of saved edits. Changes on every saved edit. */
  readonly revision: string;
  readonly edits: number;
  readonly pack: string;
  readonly draft: DictionaryDraft;
  readonly draftJson: string;
  /** SHA-256 over `draftJson`, or null while it is being computed for this exact draft. */
  readonly digest: string | null;
  readonly rows: readonly ReviewRow[];
  readonly settings: SettingsReview;
}

const revisionOf = (generation: string, edits: number) => `${generation}/${edits}`;

export function startReview(draft: DictionaryDraft, generation: string): Review {
  return Object.freeze({
    generation,
    revision: revisionOf(generation, 0),
    edits: 0,
    pack: draft.pack,
    draft,
    draftJson: draftJson(draft),
    digest: null,
    rows: Object.freeze(draft.definitions.map(definition => Object.freeze({ definition, proposed: definition.meaning, status: 'proposed' as const, pin: null }))),
    settings: Object.freeze({ accepted: false, pin: null }),
  });
}

export function withDigest(review: Review, digest: string): Review {
  return Object.freeze({ ...review, digest });
}

/** The pin a control rendered for this review must carry, or null while the digest is still being computed. */
export function pinOf(review: Review): ReviewPin | null {
  return review.digest === null ? null : Object.freeze({ revision: review.revision, digest: review.digest });
}

/** Whether an intent names exactly this review: same revision, same content digest, digest present. */
export function pinMatches(review: Review, pin: ReviewPin): boolean {
  return review.digest !== null && review.revision === pin.revision && review.digest === pin.digest;
}

export function rowOf(review: Review, name: string): ReviewRow | undefined {
  return review.rows.find(row => row.definition.name === name);
}

/** Whether a row's acceptance still names the exact current definition text. */
export function rowAccepted(row: ReviewRow): boolean {
  return row.status === 'accepted' && row.pin === definitionJson(row.definition);
}

export function settingsAccepted(review: Review): boolean {
  return review.settings.accepted && review.settings.pin === settingsJson(review.draft);
}

export function acceptedRows(review: Review): readonly ReviewRow[] {
  return review.rows.filter(rowAccepted);
}

/** Everything a person must have accepted before Publish exists at all. */
export function allReviewed(review: Review): boolean {
  return review.digest !== null && review.draftJson === draftJson(review.draft) && review.rows.every(rowAccepted) && settingsAccepted(review);
}

/**
 * One Accept click on one row. The click names the review revision and digest its control
 * was rendered with; a click rendered for an older review or draft is refused and changes nothing.
 */
export function acceptRow(review: Review, name: string, pin: ReviewPin): Review | null {
  if (!pinMatches(review, pin)) return null;
  const row = rowOf(review, name);
  if (row === undefined || rowAccepted(row)) return null;
  return Object.freeze({
    ...review,
    rows: Object.freeze(review.rows.map(item => (item === row ? Object.freeze({ ...item, status: 'accepted' as const, pin: definitionJson(item.definition) }) : item))),
  });
}

/** One Accept click on the settings row, pinned to the exact proposed settings of the current draft. */
export function acceptSettings(review: Review, pin: ReviewPin): Review | null {
  if (!pinMatches(review, pin) || settingsAccepted(review)) return null;
  return Object.freeze({ ...review, settings: Object.freeze({ accepted: true, pin: settingsJson(review.draft) }) });
}

/**
 * A plain-language change to one meaning, from an editor rendered for `revision`. Returns
 * the new review with a cleared digest and the next revision, or null when the revision is
 * not the current one, the name is unknown, the text is invalid, or nothing changed.
 */
export function changeMeaning(review: Review, name: string, meaning: string, revision: string): Review | null {
  if (revision !== review.revision) return null;
  const row = rowOf(review, name);
  if (row === undefined) return null;
  let draft: DictionaryDraft;
  try { draft = withMeaning(review.draft, name, meaning); } catch { return null; }
  const next = draft.definitions.find(item => item.name === name);
  if (next === undefined || next.meaning === row.definition.meaning) return null;
  const edits = review.edits + 1;
  return Object.freeze({
    ...review,
    revision: revisionOf(review.generation, edits),
    edits,
    draft,
    draftJson: draftJson(draft),
    digest: null,
    rows: Object.freeze(review.rows.map(item => {
      const definition = draft.definitions.find(candidate => candidate.name === item.definition.name);
      if (definition === undefined) return item;
      if (item === row) return Object.freeze({ definition, proposed: item.proposed, status: definition.meaning === item.proposed ? ('proposed' as const) : ('changed' as const), pin: null });
      return Object.freeze({ ...item, definition });
    })),
  });
}
