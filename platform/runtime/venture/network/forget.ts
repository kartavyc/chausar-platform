import {eraseCareerNaming} from '../playbooks/job-search-desk/privacy.ts';
import { eraseInfluencerNaming } from '../playbooks/social/influencer-privacy.ts';
import {eraseOpenPostingNaming} from '../build/open-posting-privacy.ts';
import {eraseNarrationNaming} from '../playbooks/narration-studio/privacy.ts';
import {eraseSiteNaming} from '../playbooks/website-studio/privacy.ts';
import {eraseTenderNaming} from '../playbooks/tender-desk/privacy.ts';
import {eraseNewsletterNaming} from '../playbooks/newsletter-studio/privacy.ts';
import {eraseArticleNaming} from '../playbooks/podcast-to-article/privacy.ts';
import {eraseBooksNaming} from '../playbooks/bookkeeping-cfo/privacy.ts';
import {eraseTranslationNaming} from '../playbooks/translation-studio/privacy.ts';
import {eraseRecruitingNaming} from '../playbooks/recruiting-desk/privacy.ts';
import { eraseSellerNaming } from '../playbooks/online-seller/privacy.ts';
import { eraseSocialD2Naming } from '../playbooks/social/d2-privacy.ts';
import {eraseCaNaming} from '../playbooks/ca-firm/privacy.ts';
import { eraseSocialChainNaming } from '../playbooks/social/chain-privacy.ts';
import { eraseScheduledNaming } from '../playbooks/social/scheduled-privacy.ts';
import { eraseSupportNaming } from '../playbooks/support-desk/privacy.ts';
// Chausar venture launcher, network (Ink v2 wave 4, package 4D1): Forget, the DPDP erasure of one person, in one step.
// The person goes, and so does everything kept about them: ties, evidence rows, pipeline cards and drafts, their place
// in plain-English search results, inbound mail from them or matched to their cards, leads with their email,
// notifications and proposals about them, any copy an import kept to undo a merge (by id or by a shared handle), and
// their name in other people's meeting titles, the owner's links to them and their name in the owner's notes (4D2).
// A decision keeps the fact that it was made, without them. What stays is only what keeps them out later: a keyed
// one-way check (HMAC-SHA256) of their emails, phones and LinkedIn address,
// with the network key the host keeps on the secret shelf (derived from the vault's own key, never in a record), so a
// copy of the records cannot be used to test addresses against it. A client with invoices keeps the client and invoice
// records the law needs, and the reply says which.
import { check, ChausarError, type Context } from '../../contracts.ts';
import type { ForgottenRecord, NetworkForgotten, NetworkImportRecord, PersonFact, PersonRecord, VentureDeps } from '../contracts.ts';
import { exactPayload, identifier, listRecords, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import { removeRecords } from './people.ts';
import { readAs } from '../delivery/shared.ts';
import { fold, handleHash, plural } from './text.ts';
import { eraseNotesNaming } from '../agents/notes.ts';
import { eraseRelaysNaming } from '../agents/relay.ts';
import { eraseContractsNaming } from '../money/order-contracts.ts';
import { eraseKnowledgeNaming } from '../agents/knowledge.ts';
import { eraseFileCallsNaming } from '../core/attachment.ts';
import { eraseFileRequestsNaming } from '../build/file-requests.ts';
import { importedMailOf } from '../build/mail-in.ts';
import {eraseYoutubeResearch} from '../playbooks/youtube/research-privacy.ts';
import { eraseRoutinesNaming } from '../agents/routines.ts';
import { eraseCallText, removeFromSearches } from './saved-searches.ts';

/** Said with every Forget: a backup the owner made earlier is a copy Chausar cannot reach into. */
/** What a model call's stored text reads as once it named someone the owner asked Chausar to forget (4E3). */
export const ERASED_NAMED_CALL = 'Erased: it named someone you asked Chausar to forget.';
/** 4J6: said with Forget when the never-contact list of the businesses on this computer took them, or could not. */
export const SHARED_CHECK_LINE = "A second one-way check, made with this computer's key, stops every business on this computer from drafting to them.";
export const NO_SHARED_CHECK_LINE = "Chausar couldn't make the shared check on this computer, so another business here could still draft to them.";
export const BACKUPS_LINE = 'Backups made before now still hold this person until those backups are deleted.';
export const CHECK_LINE = 'A one-way check of their email, phone and LinkedIn address, made with a key that never leaves this business\'s lock, so a file you import later leaves them out. It cannot be turned back into an address.';
export const NO_CHECK_LINE = 'Chausar could not keep the check here, so a file you import later that mentions them brings them back. Take them out of the file first.';
const FORGOTTEN_WORDS = 'someone you asked Chausar to forget';

/** The network key from the secret shelf, or null when the host could not derive one. */
export function networkKey(deps: VentureDeps): string | null {
  const key = deps.secrets.get('network:forget');
  return key && key.length >= 32 ? key : null;
}

/** The forgotten list of a business, ready to check: the key, every handle check with its record, every name-word check. */
export type ForgottenIndex = { key: string; hashes: ReadonlyMap<string, string>; names: ReadonlySet<string> };

/** The words of a name that the forgotten list checks: folded, three letters or more, once each. */
export function nameWords(names: string[]): string[] {
  return [...new Set(names.flatMap(name => fold(name).split(' ')).filter(word => [...word].length >= 3))];
}

/**
 * The forgotten list, or null when it holds no checks. Refuses (TIER_UNAVAILABLE) when there are checks and no key to
 * run them with: an import would otherwise let a forgotten person back in.
 */
export function forgottenIndex(records: ForgottenRecord[], key: string | null): ForgottenIndex | null {
  const checked = records.filter(record => record.hashes.length > 0 || (record.names ?? []).length > 0);
  if (!checked.length) return null;
  if (!key) throw new ChausarError('TIER_UNAVAILABLE', 'Chausar cannot check the people you asked it to forget on this computer right now, so it imports nothing. Open the business again and retry.');
  const hashes = new Map<string, string>();
  const names = new Set<string>();
  for (const record of checked) {
    for (const item of record.hashes) hashes.set(item.hash, record.id);
    for (const hash of record.names ?? []) names.add(hash);
  }
  return { key, hashes, names };
}

/** The forgotten record a person's handles match, or null. */
export function forgottenMatch(index: ForgottenIndex | null, handles: { emails: string[]; phones: string[]; linkedinUrl: string | null }): string | null {
  if (!index) return null;
  const pairs: ['email' | 'phone' | 'linkedin', string][] = [
    ...handles.emails.map(value => ['email', value] as ['email', string]), ...handles.phones.map(value => ['phone', value] as ['phone', string]),
    ...(handles.linkedinUrl ? [['linkedin', handles.linkedinUrl] as ['linkedin', string]] : []),
  ];
  for (const [kind, value] of pairs) {
    const found = index.hashes.get(handleHash(index.key, kind, value));
    if (found) return found;
  }
  return null;
}

/** A handle fact that a forgotten check matches: Undo never brings one back. */
export function forgottenFact(index: ForgottenIndex | null, fact: PersonFact): boolean {
  if (!index) return false;
  if (fact.kind === 'email') return !!forgottenMatch(index, { emails: [fact.value], phones: [], linkedinUrl: null });
  if (fact.kind === 'phone') return !!forgottenMatch(index, { emails: [], phones: [fact.value], linkedinUrl: null });
  if (fact.kind === 'linkedin') return !!forgottenMatch(index, { emails: [], phones: [], linkedinUrl: fact.value });
  return false;
}

/** True when a meeting title has a word of a forgotten person's name, by the keyed check. */
export function titleForgotten(index: ForgottenIndex | null, title: string): boolean {
  if (!index || !index.names.size) return false;
  return fold(title).split(' ').some(word => [...word].length >= 3 && index.names.has(handleHash(index.key, 'name', word)));
}

/**
 * A meeting or mail fact with forgotten people taken out by the keyed checks: their addresses leave the "with" list and
 * a title naming them reads "Meeting". Other facts come back as they are. Used on every import and every Undo copy.
 */
export function withoutForgotten<F extends { kind: string; value: string; detail: unknown }>(fact: F, index: ForgottenIndex | null): F {
  if (!index || (fact.kind !== 'meeting' && fact.kind !== 'mail') || !fact.detail || typeof fact.detail !== 'object') return fact;
  const detail = { ...(fact.detail as Record<string, unknown>) };
  // "with", and (4D2) "between": who they exchanged a mail with, one of the two its sender.
  for (const key of ['with', 'between'] as const) {
    if (!Array.isArray(detail[key])) continue;
    const kept = (detail[key] as string[]).filter(email => !forgottenMatch(index, { emails: [email], phones: [], linkedinUrl: null }));
    if (kept.length) detail[key] = kept; else delete detail[key];
  }
  let value = fact.value;
  if (fact.kind === 'meeting') {
    if (Array.isArray(detail.titles)) detail.titles = (detail.titles as string[]).map(title => (titleForgotten(index, title) ? 'Meeting' : title));
    if (titleForgotten(index, value)) value = 'Meeting';
  }
  return { ...fact, value, detail: detail as F['detail'] };
}

/** One person's meeting and mail facts with the given people's addresses and name taken out; changed tells whether any was. */
function scrubFacts(person: PersonRecord, emails: ReadonlySet<string>, mentionsName: (text: unknown) => boolean): { facts: PersonFact[]; changed: boolean } {
  let changed = false;
  const facts = person.facts.map(fact => {
    if (fact.kind !== 'meeting' && fact.kind !== 'mail') return fact;
    const detail = { ...(fact.detail as Record<string, unknown>) };
    for (const key of ['with', 'between'] as const) {
      if (!Array.isArray(detail[key])) continue;
      const kept = (detail[key] as string[]).filter(email => !emails.has(email));
      if (kept.length !== (detail[key] as string[]).length) { changed = true; if (kept.length) detail[key] = kept; else delete detail[key]; }
    }
    let value = fact.value;
    if (fact.kind === 'meeting') {
      const titles = (detail.titles as string[] | undefined) ?? [];
      const clean = titles.map(title => (mentionsName(title) ? 'Meeting' : title));
      if (clean.some((title, i) => title !== titles[i])) { changed = true; detail.titles = clean; }
      if (mentionsName(value)) { changed = true; value = 'Meeting'; }
    }
    return { ...fact, value, detail: detail as never };
  });
  return { facts, changed };
}

/**
 * What the owner said about other people (4D2) without the people forgotten: a link to one of them goes, its fact and
 * its history entry both, and so does a link that no longer leads to anyone (dropLink says which); their name in the
 * owner's notes ("you said" and the notes on links) reads "someone you asked Chausar to forget". gone: their ids and the
 * ids of everyone merged into them, however long the chain.
 */
function scrubOwnerWords(facts: PersonFact[], history: PersonRecord['history'], gone: ReadonlySet<string>, names: RegExp | null, dropLink: (id: string) => boolean = id => gone.has(id)): { facts: PersonFact[]; history: PersonRecord['history']; changed: boolean } {
  const unnamed = (text: string) => (names
    ? text.replace(new RegExp(names.source, names.flags), FORGOTTEN_WORDS).replace(new RegExp(`${FORGOTTEN_WORDS}(?:\\s+${FORGOTTEN_WORDS})+`, 'g'), FORGOTTEN_WORDS)
    : text);
  let changed = false;
  const kept = facts.filter(fact => !(fact.kind === 'link' && dropLink(String((fact.detail as { personId?: string } | null)?.personId))));
  if (kept.length !== facts.length) changed = true;
  const out = kept.map(fact => {
    if (fact.kind !== 'you-said' && fact.kind !== 'link') return fact;
    const detail = { ...(fact.detail as Record<string, unknown> | null ?? {}) };
    const note = typeof detail.note === 'string' ? unnamed(detail.note) : detail.note;
    const value = unnamed(fact.value);
    if (note === detail.note && value === fact.value) return fact;
    changed = true;
    return { ...fact, value, detail: { ...detail, note } as PersonFact['detail'] };
  });
  const entries = history.filter(entry => !(entry.op === 'link' && entry.from.some(id => gone.has(id))));
  if (entries.length !== history.length) changed = true;
  return { facts: out, history: entries, changed };
}

/**
 * Words that name a person in free text: every name their files gave them (a merge keeps each), and each part of three
 * letters or more; a part followed by an initial ("Farhan A.") goes with the initial (4D2).
 */
function namePattern(people: PersonRecord[]): RegExp | null {
  const parts = new Set<string>();
  for (const person of people) {
    const names = new Set([person.name, ...person.facts.filter(fact => fact.kind === 'name').map(fact => fact.value)].map(name => name.trim()));
    for (const name of names) {
      if (!name || name.includes('@') || name.startsWith('+') || name.startsWith('http')) continue;
      parts.add(name);
      for (const word of name.split(/[\s,.]+/)) if ([...word].length >= 3) parts.add(word);
    }
  }
  if (!parts.size) return null;
  const escape = (part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sorted = [...parts].sort((a, b) => b.length - a.length);
  // "Farhan A." (an initial with its full stop); "Farhan A" without one is a name of its own and comes from their files.
  const initials = sorted.filter(part => !/\s/.test(part)).map(part => `${escape(part)}\\s+\\p{L}\\.`);
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...initials, ...sorted.map(escape)].join('|')})(?![\\p{L}\\p{N}])`, 'giu');
}

const sharesHandle = (person: PersonRecord, emails: ReadonlySet<string>, phones: ReadonlySet<string>, urls: ReadonlySet<string>) =>
  person.handles.emails.some(email => emails.has(email)) || person.handles.phones.some(phone => phones.has(phone)) || (!!person.handles.linkedinUrl && urls.has(person.handles.linkedinUrl));

/**
 * Removes people and the records kept about them. erase (Forget): also inbound mail from their addresses or matched to
 * their cards, leads with their email, notifications and proposals about them, Undo copies sharing a handle with them,
 * their name in other people's meeting titles and their address in other people's "with" lists; decisions keep the
 * fact without them. An Undo (erase false) removes only what the import's people had: ties, evidence, cards and drafts.
 * Answers how many pipeline cards and drafts went.
 */
export function removePersonData(tx: VentureTx, people: PersonRecord[], options: { erase: boolean; secrets?: VentureDeps['secrets'] }): { cards: number; drafts: number } {
  const ids = new Set(people.map(person => person.id));
  if (!ids.size) return { cards: 0, drafts: 0 };
  const emails = new Set(people.flatMap(person => person.handles.emails));
  const phones = new Set(people.flatMap(person => person.handles.phones));
  const urls = new Set(people.flatMap(person => (person.handles.linkedinUrl ? [person.handles.linkedinUrl] : [])));
  // 4E1: Forget erases the leads with their email, and with them the pipeline cards those leads made (a card stored
  // before the person was imported names the lead, not the person).
  const leadIds = new Set(options.erase ? tx.list('venture-lead').filter(lead => typeof lead.email === 'string' && emails.has(lead.email.toLowerCase())).map(lead => lead.id) : []);
  const cardIds = new Set(tx.list('venture-opportunity')
    .filter(card => ids.has(card.personId) || leadIds.has(card.personId) || (!!card.leadId && leadIds.has(card.leadId))).map(card => card.id));
  // 4E2: a draft that names them (the person a double opt-in introduces, an intro request's target) goes too, by their id
  // or the id of anyone merged into them.
  const named = new Set([...ids, ...people.flatMap(person => person.history.filter(entry => entry.op === 'merge').map(entry => entry.from[0]))]);
  const draftIds = new Set(tx.list('venture-outreach').filter(draft => (draft.personId && ids.has(draft.personId)) || (draft.opportunityId && cardIds.has(draft.opportunityId))
    || (draft.aboutPersonId && named.has(draft.aboutPersonId))).map(draft => draft.id));
  const traceIds = [...ids, ...cardIds, ...draftIds, ...leadIds];
  // 4E1: the records a sum receipt may count them by (4D2's band receipts count ties): any receipt that does goes too.
  const countedIds = new Set([...traceIds, ...tx.list('venture-tie').filter(tie => ids.has(tie.personId)).map(tie => tie.id)]);
  const mentionsId = (text: unknown) => typeof text === 'string' && traceIds.some(id => text.includes(id));
  const names = options.erase ? namePattern(people) : null;
  const mentionsName = (text: unknown) => typeof text === 'string' && !!names && new RegExp(names.source, names.flags).test(text);
  // 4D2: the ids the owner's links may name them by: their own, and those of people merged into them.
  const gone = new Set([...ids, ...people.flatMap(person => person.history.filter(entry => entry.op === 'merge').map(entry => entry.from[0]))]);
  removeFromSearches(tx, people, { erase: options.erase, mentionsName }); // 4D3: calls that carried them, words that named them
  for (const search of tx.list('venture-network-search')) {
    if (!search.results.some(result => result.personId && ids.has(result.personId)) && !search.shown.some(id => ids.has(id))) continue;
    tx.replace({ ...search, results: search.results.filter(result => !(result.personId && ids.has(result.personId))), shown: search.shown.filter(id => !ids.has(id)) });
  }
  for (const record of tx.list('venture-network-import')) {
    let scrubbed = false;
    const absorbed = record.absorbed
      ?.filter(item => !ids.has(item.into) && !ids.has(item.person.id) && !(options.erase && sharesHandle(item.person, emails, phones, urls)))
      .map(item => {
        if (!options.erase) return item;
        const clean = scrubFacts(item.person, emails, mentionsName);
        const said = scrubOwnerWords(clean.facts, item.person.history, gone, names);
        if (!clean.changed && !said.changed) return item;
        scrubbed = true;
        return { ...item, person: { ...item.person, facts: said.facts, history: said.history } };
      });
    const before = record.before?.filter(item => !ids.has(item.id));
    if (!scrubbed && absorbed?.length === record.absorbed?.length && before?.length === record.before?.length) continue;
    tx.replace<NetworkImportRecord>({ ...record, ...(absorbed ? { absorbed } : {}), ...(before ? { before } : {}) });
  }
  if (options.erase) {
    // 4D2: a link the owner made leads to someone who stays, directly or through the merges they took in; one that
    // leads to no one any more goes too.
    const staying = tx.list('venture-person').filter(person => !ids.has(person.id));
    const live = new Set(staying.map(person => person.id));
    const into = new Map<string, string>();
    for (const person of staying) for (const entry of person.history) if (entry.op === 'merge' && entry.from[0]) into.set(entry.from[0], person.id);
    const leadsNowhere = (id: string) => {
      let current: string | undefined = id;
      for (let hop = 0; current && hop < 16; hop += 1) { if (live.has(current)) return false; current = into.get(current); }
      return true;
    };
    for (const person of staying) {
      const clean = scrubFacts(person, emails, mentionsName);
      const said = scrubOwnerWords(clean.facts, person.history, gone, names, id => gone.has(id) || leadsNowhere(id));
      if (clean.changed || said.changed) tx.replace<PersonRecord>({ ...person, facts: said.facts, history: said.history });
    }
    for (const decision of tx.list('venture-decision')) {
      const scrub = (text: string) => traceIds.reduce((out, id) => out.split(id).join('forgotten'), text);
      const subject = scrub(decision.subject), rowId = decision.rowId === null ? null : scrub(decision.rowId);
      const reason = names
        ? decision.reason.replace(new RegExp(names.source, names.flags), FORGOTTEN_WORDS).replace(new RegExp(`${FORGOTTEN_WORDS}(?:\\s+${FORGOTTEN_WORDS})+`, 'g'), FORGOTTEN_WORDS)
        : decision.reason;
      if (subject !== decision.subject || rowId !== decision.rowId || reason !== decision.reason) tx.replace({ ...decision, subject, rowId, reason });
    }
    // 4B2: the agents' notes, their changes, note and instruction proposals and thread messages that name them.
    if (names) eraseNotesNaming(tx, mentionsName);
    // 4J12: messages between agents, and order contract words (with their marks and a run's contract check), that name them.
    if (names) { eraseRelaysNaming(tx, mentionsName); eraseContractsNaming(tx, mentionsName); }
    // 4J18: their name in what the AI knows (the sources' titles, words and page addresses) and in kept ideas.
    // 5A3 review: an idea's words lose their email and phone too.
    eraseKnowledgeNaming(tx, names, [...emails, ...phones]);
    eraseSupportNaming(tx, emails, mentionsName, phones);
    eraseCareerNaming(tx,new Set(people.flatMap(person=>person.clientId?[person.clientId]:[])),new Set([...emails,...phones,...urls]),mentionsName);
    eraseTenderNaming(tx,new Set(people.flatMap(person=>person.clientId?[person.clientId]:[])),new Set([...emails,...phones,...urls]),mentionsName);
    eraseOpenPostingNaming(tx,new Set(people.flatMap(person=>person.clientId?[person.clientId]:[])),new Set([...emails,...phones,...urls]),mentionsName,options.secrets);
    eraseNewsletterNaming(tx,new Set(people.flatMap(person=>person.clientId?[person.clientId]:[])),new Set([...emails,...phones,...urls]),mentionsName);
    eraseNarrationNaming(tx,new Set(people.flatMap(person=>person.clientId?[person.clientId]:[])),new Set([...emails,...phones,...urls]),mentionsName);
    eraseArticleNaming(tx,new Set(people.flatMap(person=>person.clientId?[person.clientId]:[])),new Set([...emails,...phones,...urls]),mentionsName);
    eraseSiteNaming(tx,new Set(people.flatMap(person=>person.clientId?[person.clientId]:[])),new Set([...emails,...phones,...urls]),mentionsName,options.secrets);
    eraseBooksNaming(tx,new Set(people.flatMap(person=>person.clientId?[person.clientId]:[])),new Set([...emails,...phones,...urls]),mentionsName,options.secrets);
    eraseYoutubeResearch(tx,new Set(people.flatMap(person=>person.clientId?[person.clientId]:[])),new Set([...emails,...phones,...urls]),mentionsName);
    eraseSellerNaming(tx,new Set(people.flatMap(person=>person.clientId?[person.clientId]:[])),new Set([...emails,...phones,...urls]),mentionsName,options.secrets);
    eraseCaNaming(tx,new Set(people.flatMap(person=>person.clientId?[person.clientId]:[])),new Set([...emails,...phones,...urls]),mentionsName);
    eraseRecruitingNaming(tx,new Set([...emails,...phones,...urls]),mentionsName);
    eraseScheduledNaming(tx, new Set([...emails,...phones,...urls]), mentionsName);
    eraseSocialChainNaming(tx,new Set([...emails,...phones,...urls]),mentionsName);
    eraseSocialD2Naming(tx,new Set([...emails,...phones,...urls]),mentionsName,new Set(people.flatMap(person=>person.clientId?[person.clientId]:[])));
    eraseInfluencerNaming(tx,new Set(people.flatMap(person=>person.clientId?[person.clientId]:[])),new Set([...emails,...phones,...urls]),mentionsName);
    // 4J8: the text of calls that carried a file the owner dropped (the plan, a plan suggestion) when it names them.
    if (names) eraseFileCallsNaming(tx, mentionsName);
    // 4J7 (K9, O20): a file request's note, a client's file name and a share link comment that name them.
    if (names) eraseFileRequestsNaming(tx, mentionsName);
    // 4J22a: a routine's prompt or name that names them (the prompt erased, the routine switched off).
    if (names) eraseRoutinesNaming(tx, mentionsName);
    // 4E3 (NOTES item 28, for every package): after the narrower scrubs above, the stored text of every other model call
    // of any purpose that names them (by a name their files gave, or one of their addresses) is erased the way 4B2 erases
    // a forgotten note: its texts become ERASED_NAMED_CALL with erasedAt, its digest, ids, costs and times kept; a waiting
    // preview is expired so it can never go; a call already erased is left as it is (4D3's eraseCallText).
    const handles = [...emails, ...phones, ...urls].filter(handle => handle.length >= 5);
    const naming = (text: unknown) => typeof text === 'string' && (mentionsName(text) || handles.some(handle => text.toLowerCase().includes(handle.toLowerCase())));
    eraseCallText(tx, new Set(), ERASED_NAMED_CALL, call => Object.entries(call).some(([key, value]) => key.endsWith('Text') && naming(value))
      || naming((call as { error?: { message?: unknown } | null }).error?.message));
    // 4E3: the calls Today would ask for notes about leave them out; a call left with no one goes.
    for (const feed of tx.list('venture-calendar-feed')) {
      const events = feed.events.map(event => ({ ...event, personIds: event.personIds.filter(id => !ids.has(id)) })).filter(event => event.personIds.length > 0);
      if (events.length !== feed.events.length || events.some((event, i) => event.personIds.length !== feed.events[i].personIds.length)) tx.replace({ ...feed, events });
    }
  }
  let cards = 0, drafts = 0;
  // 5A6: imported mail keeps words and files, so each imported message of a thread they wrote in, were sent or copied in.
  const importedGone = options.erase && tx.venture ? importedMailOf(tx.state, tx.venture, emails, mentionsName) : new Set<string>();
  removeRecords(tx, record => {
    switch (record.kind) {
      case 'venture-person': return ids.has(record.id as string);
      case 'venture-tie': return ids.has(record.personId as string);
      case 'venture-evidence': return typeof record.subject === 'string' && record.subject.startsWith('person:') && ids.has(record.subject.slice(7));
      case 'venture-opportunity': if (cardIds.has(record.id as string)) { cards += 1; return true; } return false;
      case 'venture-outreach': if (draftIds.has(record.id as string)) { drafts += 1; return true; } return false;
      case 'venture-inbound': {
        if (!options.erase) return false;
        const matched = (record.matched as { opportunityId?: string } | null)?.opportunityId;
        // 4E3: also a delivery report about one of their addresses, mail kept as theirs by name or LinkedIn address, and
        // mail that waits on the owner to say whether it is about one of their cards.
        const bounced = ((record.bounces as { address?: string }[] | undefined) ?? []).some(item => typeof item.address === 'string' && emails.has(item.address));
        const candidates = (record.candidates as { opportunityId?: string }[] | undefined) ?? [];
        return importedGone.has(record.id as string)
          || (typeof record.from === 'string' && emails.has(record.from.trim().toLowerCase())) || (!!matched && (cardIds.has(matched) || leadIds.has(matched)))
          || bounced || (typeof record.personId === 'string' && ids.has(record.personId))
          || candidates.some(item => !!item.opportunityId && (cardIds.has(item.opportunityId) || leadIds.has(item.opportunityId)));
      }
      case 'venture-lead-source': {
        if (!options.erase) return false;
        const evidence = JSON.stringify(record.community ?? null);
        return (typeof record.personId === 'string' && ids.has(record.personId)) || mentionsName(evidence) || [...emails, ...phones].some(contact => evidence.toLowerCase().includes(contact.toLowerCase()));
      }
      case 'venture-lead': return options.erase && typeof record.email === 'string' && emails.has(record.email.toLowerCase());
      case 'venture-notification': return options.erase && (mentionsId(record.subject) || mentionsId(record.rowId) || mentionsName(record.title));
      case 'venture-proposal': return options.erase && (mentionsId(JSON.stringify(record.input ?? null)) || mentionsName(record.title) || mentionsName(record.line));
      // Ink v2 wave 5 (5A2): a sales proposal drafted for them (playbooks/kit/proposal.ts) goes as their drafts do, on an
      // Undo too; Forget also takes one drafted for their client and any whose words name them.
      // 5K1: client-linked promises retain contact words and disappear on Forget.
      case 'venture-promise-to-pay': case 'venture-collection-stage': return options.erase
        && ((typeof record.clientId === 'string' && people.some(person => person.clientId === record.clientId))
          || mentionsName(record.statedBy) || mentionsName(JSON.stringify(record.ladder ?? null))
          || (typeof record.statedBy === 'string' && [...emails, ...phones].some(contact => String(record.statedBy).toLowerCase().includes(contact.toLowerCase()))));
      case 'venture-sales-proposal': return (typeof record.personId === 'string' && ids.has(record.personId))
        || (options.erase && ((typeof record.clientId === 'string' && people.some(person => person.clientId === record.clientId))
          || mentionsName(record.toName) || mentionsName(record.text)));
      case 'venture-sum-receipt': return options.erase && Array.isArray(record.addends)
        && (record.addends as { recordId?: unknown }[]).some(addend => countedIds.has(addend.recordId as string));
      default: return false;
    }
  });
  return { cards, drafts };
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * venture.network.forget { id } (approve, inside the app): forgets one person, as above. A person linked to a client
 * keeps the client record (and its invoices, which the law keeps); everything else about them is deleted. The reply
 * says what stays: the law's records, the keyed check (or that there was no key to make one), and earlier backups.
 */
export async function networkForget(deps: VentureDeps, ctx: Context, payload: unknown): Promise<NetworkForgotten> {
  requireAppChannel(ctx, 'venture.network.forget');
  const body = exactPayload(payload, ['id'], ['id']);
  const id = identifier(body.id, 'id');
  const key = networkKey(deps);
  readAs(deps, ctx, 'approve'); // a caller who may not forget adds no one to the shared list (4J6)
  const shared = await shareForgotten(deps, id);
  return ventureAction(deps, ctx, 'approve', 'network.forget', tx => {
    const person = tx.find('venture-person', id);
    check(person, 'INVALID_VENTURE_REQUEST', 'This person is not in your network.');
    // A handle another person also has would block that person's own later files: refuse, and say who.
    for (const other of tx.list('venture-person')) {
      if (other.id === person.id) continue;
      const shared = other.handles.emails.find(email => person.handles.emails.includes(email))
        ?? other.handles.phones.find(phone => person.handles.phones.includes(phone))
        ?? (other.handles.linkedinUrl && other.handles.linkedinUrl === person.handles.linkedinUrl ? other.handles.linkedinUrl : undefined);
      check(!shared, 'INVALID_VENTURE_REQUEST', `${other.name} also has ${shared}. Merge the two first, then forget them.`);
    }
    // Only the names their files gave (a name made from an address would turn words like "example" into checks).
    const nameHashes = !key ? [] : nameWords(person.facts.filter(fact => fact.kind === 'name').map(fact => fact.value)).map(word => handleHash(key, 'name', word));
    const hashes: ForgottenRecord['hashes'] = !key ? [] : [
      ...person.handles.emails.map(value => ({ kind: 'email' as const, hash: handleHash(key, 'email', value) })),
      ...person.handles.phones.map(value => ({ kind: 'phone' as const, hash: handleHash(key, 'phone', value) })),
      ...(person.handles.linkedinUrl ? [{ kind: 'linkedin' as const, hash: handleHash(key, 'linkedin', person.handles.linkedinUrl) }] : []),
    ];
    const client = person.clientId ? tx.find('venture-client', person.clientId) : undefined;
    const invoices = client ? tx.list('venture-invoice').filter(invoice => invoice.clientId === client.id).length : 0;
    const kept = !client ? [] : invoices > 0 ? ['The client record, for the invoices', plural(invoices, 'invoice', 'invoices')] : ['The client record, in Clients'];
    const first = firstName(person.name);
    const line = !client
      ? (key ? `Chausar forgot ${first}. A file you import later leaves ${first} out.` : `Chausar forgot ${first}.`)
      : invoices > 0
        ? `${first} is your client. ${first}'s invoices stay; everything else Chausar kept about ${first} is gone.`
        : `${first} is your client, so the client record stays in Clients; everything else Chausar kept about ${first} is gone.`;
    const removed = removePersonData(tx, [person], { erase: true, secrets: deps.secrets });
    tx.put<ForgottenRecord>({ ...tx.base('venture-forgotten'), hashes, names: nameHashes, kept, by: ctx.memberId, scheme: 'hmac-sha256' });
    if (removed.cards || removed.drafts) tx.emit('pipeline.changed', {});
    tx.emit('privacy.forgotten', {});
    const sharedLine = shared === 'made' ? [SHARED_CHECK_LINE] : shared === 'failed' ? [NO_SHARED_CHECK_LINE] : [];
    return { line, kept: [...kept, key ? CHECK_LINE : NO_CHECK_LINE, ...sharedLine, BACKUPS_LINE] };
  });
}

/**
 * 4J6 (C10): before Forget, the person's emails, phones and LinkedIn page join the never-contact list of the businesses
 * on this computer, as keyed checks the host makes. Skipped when Forget would refuse (no such person, or a handle
 * someone else also has). 'failed' when the host could not make the check: Forget goes on and says so; null with no list.
 */
async function shareForgotten(deps: VentureDeps, id: string): Promise<'made' | 'failed' | null> {
  const list = deps.workspace?.neverContact;
  if (!list) return null;
  const people = listRecords(deps.store.read(), 'venture-person');
  const person = people.find(item => item.id === id);
  if (!person) return null;
  const handles = [...person.handles.emails, ...person.handles.phones, ...(person.handles.linkedinUrl ? [person.handles.linkedinUrl] : [])];
  const sharesOne = people.some(other => other.id !== id && (other.handles.emails.some(email => person.handles.emails.includes(email))
    || other.handles.phones.some(phone => person.handles.phones.includes(phone)) || (!!other.handles.linkedinUrl && other.handles.linkedinUrl === person.handles.linkedinUrl)));
  if (!handles.length || sharesOne) return null;
  try { await list.add(handles); return 'made'; } catch { return 'failed'; }
}
