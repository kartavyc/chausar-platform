// Chausar venture launcher, network (Ink v2 wave 4, package 4D1): the engine-side helpers for the owner's network. The
// cleaning and handle rules are the extractor's own (extract-core.ts), re-exported so the engine and the desktop read
// files the same way; the engine adds what it alone does: the person entry it builds from a projection, and the keyed
// one-way check (HMAC-SHA256) that keeps a forgotten person out of later imports.
import { createHmac } from 'node:crypto';
import type { IsoDate, Json, PersonFactKind } from '../contracts.ts';

export {
  cleanText, count, Drops, DROPPED, fold, foldCompany, MAX_COMPANY, MAX_GROUP, MAX_NAME, MAX_SUMMARY, MAX_TITLE, normalEmail, normalLinkedIn, normalPhone, plural,
} from './extract-core.ts';

/** What one projected person says, as the engine builds facts from it: who they are, and what happened. */
export type ParsedEntry = {
  line: number;
  name: string | null;
  emails: string[];
  phones: string[];
  linkedinUrl: string | null;
  role: { title: string | null; company: string | null } | null;
  facts: { kind: PersonFactKind; value: string; date: IsoDate | null; detail: Json | null }[];
};

/**
 * The keyed one-way check of one handle (or one name word) for the forgotten list: HMAC-SHA256 with the business's network key, which is
 * kept on the engine's secret shelf (derived from the vault's own key when it opens) and never in a record, so a copy of
 * the records cannot be used to test phone numbers against it.
 */
export function handleHash(key: string, kind: 'email' | 'phone' | 'linkedin' | 'name', value: string): string {
  return createHmac('sha256', key).update(`${kind}\n${value}`).digest('hex');
}
