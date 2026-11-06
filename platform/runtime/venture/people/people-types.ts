import type { KeyedPeopleServiceId, PeopleServiceId, PeopleSearchView, PeopleServiceView, SavedPeopleKeys } from '../../../contract/venture/people/people-types.ts';
export type { KeyedPeopleServiceId, PeopleServiceId, PeopleSearchView, PeopleServiceView, SavedPeopleKeys } from '../../../contract/venture/people/people-types.ts';
// Wave 6 (6F8): the shapes of people search, with no Node imports, so the Ink app's fake engine and types share them.


/** Kept in the business file: the key's last four characters and when it was saved. Never the key. */



/** venture.people.services: the services, their honest labels and which have the owner's key. */


export type PersonFound = { name: string; title: string | null; company: string | null; summary: string | null; mutuals: number; url: string };
export type CompanyFound = { name: string; id: string; status: string | null; formed: string | null; kind: string | null; state: string | null };
/**
 * venture.people.lookup. quote: what the owner approves (nothing sent yet). running: Happenstance is searching; ask again
 * with searchId. done: the answer. refused: the service said no and nothing was used. unknown: it may have happened;
 * check the service before trying again.
 */
export type PeopleLookupView = {
  service: KeyedPeopleServiceId; state: 'quote' | 'running' | 'done' | 'refused' | 'unknown';
  quote: { query: string; line: string; digest: string } | null;
  searchId: string | null; label: string; line: string;
  people?: PersonFound[]; companies?: CompanyFound[]; held?: number;
};
