// Chausar venture launcher, network (Ink v2 wave 4, package 4D2): warm paths to one person, honest about what Chausar
// can and cannot see. A path is direct (the owner's own tie), or runs through a connector the owner knows. The second
// leg is confirmed only by a fact: both people in one small meeting with the owner, one mail one of the two wrote with
// the other on it (a mail the owner sent to both confirms nothing), or the owner's own word (venture.network.link).
// Someone at the same company the owner knows at Know or better, with no such fact, is only a "possible path, not
// confirmed"; a company name never confirms anything, and a generic employer (Self-employed) is no company. The weaker
// leg ranks a path (the stronger breaks a tie), and an unknown leg ranks below every confirmed path. Paths are worked out
// when read, from the people here now and their stored ties: a hidden person is never offered as a connector, and a
// forgotten one is not here (Forget removes them, their links and their addresses from everyone else's facts). Every
// line is written by code from the legs.
import type { State } from '../../contracts.ts';
import type { NetworkImportKind, NetworkImportRecord, PersonFact, PersonRecord, TieBand, TieRecord, WarmPathView } from '../contracts.ts';
import { listRecords } from '../records.ts';
import { redactSecrets } from '../core/secrets.ts';
import { KIND_LABEL } from './people.ts';
import { listPeople } from './store.ts';
import { fold, foldCompany } from './text.ts';

/** A path shows at most this many, strongest first. */
export const MAX_PATHS = 3;
const RANK: Readonly<Record<TieBand, number>> = Object.freeze({ close: 4, 'know-well': 3, know: 2, 'met-once': 1, cold: 0 });
/** How strong a second leg is, by the fact behind it: the owner's word says they know each other; a meeting or a mail, that they met. */
const LEG_BAND: Readonly<Record<Leg['kind'], TieBand>> = Object.freeze({ link: 'know', meeting: 'met-once', mail: 'met-once' });
const LEG_ORDER: Readonly<Record<Leg['kind'], number>> = Object.freeze({ link: 0, meeting: 1, mail: 2 });

/** A fact that two people know each other: the owner's word with its note, or one meeting or mail and its file. */
type Leg = { kind: 'link' | 'meeting' | 'mail'; words: string };

/** What paths are worked out from, read once for any number of people (a pipeline board, a search's results). */
export type PathIndex = {
  people: ReadonlyMap<string, PersonRecord>;
  ties: ReadonlyMap<string, TieRecord>;
  company: ReadonlyMap<string, string[]>;
  legs: ReadonlyMap<string, ReadonlyMap<string, Leg>>;
};

const firstName = (name: string) => (name.includes('@') || name.startsWith('+') || name.startsWith('http') ? name : name.trim().split(/\s+/)[0] || name);

/** The file a fact came from, in words: 'Calendar, work.ics'. */
function fileWords(fact: PersonFact, imports: ReadonlyMap<string, NetworkImportRecord>): string {
  const record = fact.source.importId ? imports.get(fact.source.importId) : undefined;
  return `${KIND_LABEL[(record?.importKind ?? fact.source.connector) as NetworkImportKind] ?? 'A file you imported'}, ${redactSecrets(record?.fileName ?? 'a file you imported')}`;
}

/** The index of one business: its people, their ties, who works where, and every fact that puts two people together. */
export function pathIndex(state: State, ventureId: string): PathIndex {
  const everyone = listPeople(state, ventureId);
  const people = new Map(everyone.map(person => [person.id, person]));
  const ties = new Map<string, TieRecord>();
  for (const tie of listRecords(state, 'venture-tie', ventureId)) ties.set(tie.personId, tie);
  const imports = new Map(listRecords(state, 'venture-network-import', ventureId).map(record => [record.id, record]));
  const byEmail = new Map<string, string>();
  const company = new Map<string, string[]>();
  // A person merged away is found under the one they joined, so the owner's word about them follows the merge.
  const mergedInto = new Map<string, string>();
  for (const person of everyone) {
    for (const email of person.handles.emails) if (!byEmail.has(email)) byEmail.set(email, person.id);
    const at = foldCompany(person.role?.company);
    if (at) company.set(at, [...(company.get(at) ?? []), person.id]);
    for (const entry of person.history) if (entry.op === 'merge' && entry.from[0]?.startsWith('person_')) mergedInto.set(entry.from[0], person.id);
  }
  const resolve = (id: string | undefined): string | null => {
    let current = id;
    for (let hop = 0; current && hop < 16; hop += 1) {
      if (people.has(current)) return current;
      current = mergedInto.get(current);
    }
    return null;
  };
  const legs = new Map<string, Map<string, Leg>>();
  const put = (a: string, b: string, leg: Leg) => {
    if (a === b) return;
    for (const [from, to] of [[a, b], [b, a]]) {
      const known = legs.get(from) ?? new Map<string, Leg>();
      const before = known.get(to);
      if (!before || LEG_ORDER[leg.kind] < LEG_ORDER[before.kind]) known.set(to, leg);
      legs.set(from, known);
    }
  };
  for (const person of everyone) {
    for (const fact of person.facts) {
      if (fact.kind === 'link') {
        const detail = fact.detail as { personId?: string; note?: string } | null;
        const other = resolve(detail?.personId);
        if (other) put(person.id, other, { kind: 'link', words: detail?.note ?? '' });
      } else if (fact.kind === 'meeting' || fact.kind === 'mail') {
        // A meeting: who else was in it. A mail: only who they exchanged it with, one of the two its sender; a mail the
        // owner sent to both says nothing about whether they know each other.
        const detail = fact.detail as { with?: string[]; between?: string[] } | null;
        const together = (fact.kind === 'meeting' ? detail?.with : detail?.between) ?? [];
        for (const email of together) {
          const other = byEmail.get(email);
          if (other) put(person.id, other, { kind: fact.kind, words: fileWords(fact, imports) });
        }
      }
    }
  }
  return { people, ties, company, legs };
}

/** How the owner knows the connector, in words: 'you know Rahul well'. */
function knowWords(band: TieBand, name: string): string {
  const first = firstName(name);
  switch (band) {
    case 'close': return `you know ${first} closely`;
    case 'know-well': return `you know ${first} well`;
    case 'know': return `you know ${first}`;
    default: return `you have met ${first}`;
  }
}

/** The direct path's line, by band. */
function directLine(band: TieBand, name: string): string {
  const first = firstName(name);
  switch (band) {
    case 'close': return `You know ${first} directly, and closely.`;
    case 'know-well': return `You know ${first} directly, well.`;
    case 'know': return `You know ${first} directly.`;
    case 'met-once': return `You have met ${first}.`;
    default: return `${first} is in your network, but Chausar sees little between you.`;
  }
}

/** The second leg in words: 'Rahul and Asha were in a small meeting together (Calendar, work.ics)'. */
function legWords(leg: Leg, via: string, target: string): string {
  const a = firstName(via), b = firstName(target);
  if (leg.kind === 'link') return `you said ${a} knows ${b}: ${leg.words}`;
  if (leg.kind === 'meeting') return `${a} and ${b} were in a small meeting together (${leg.words})`;
  return `${a} and ${b} were on a mail one of them wrote (${leg.words})`;
}

type Candidate = { view: WarmPathView; confirmed: boolean; weaker: number; stronger: number; order: number; name: string; id: string };

const KIND_ORDER: Readonly<Record<WarmPathView['kind'], number>> = Object.freeze({ direct: 0, 'same-company': 1, connector: 2 });

/**
 * Up to three warm paths to one person, strongest first: confirmed paths by their weaker leg, then their stronger;
 * on a full tie direct first, then by the connector's name; every unconfirmed path after every confirmed one.
 */
export function warmPaths(index: PathIndex, personId: string, limit = MAX_PATHS): WarmPathView[] {
  const target = index.people.get(personId);
  if (!target) return [];
  const out: Candidate[] = [];
  const own = index.ties.get(personId);
  if (own) {
    out.push({
      view: { kind: 'direct', via: null, confirmed: true, strength: own.band, line: directLine(own.band, target.name) },
      confirmed: true, weaker: RANK[own.band], stronger: RANK[own.band], order: KIND_ORDER.direct, name: '', id: '',
    });
  }
  const at = foldCompany(target.role?.company);
  const legs = index.legs.get(personId) ?? new Map<string, Leg>();
  const colleagues = at ? index.company.get(at) ?? [] : [];
  for (const viaId of new Set([...legs.keys(), ...colleagues])) {
    const via = index.people.get(viaId);
    const tie = index.ties.get(viaId);
    if (viaId === personId || !via || via.hidden || !tie) continue;
    const first = RANK[tie.band];
    const leg = legs.get(viaId);
    const sameCompany = !!at && foldCompany(via.role?.company) === at;
    const kind: WarmPathView['kind'] = sameCompany ? 'same-company' : 'connector';
    const where = sameCompany ? `, also at ${target.role?.company}` : '';
    if (leg) {
      if (first < RANK['met-once']) continue;
      const second = RANK[LEG_BAND[leg.kind]];
      const weaker = Math.min(first, second);
      out.push({
        view: {
          kind, via: { id: via.id, name: via.name }, confirmed: true, strength: weaker === first ? tie.band : LEG_BAND[leg.kind],
          line: `Through ${via.name}${where}: ${knowWords(tie.band, via.name)}, and ${legWords(leg, via.name, target.name)}.`,
        },
        confirmed: true, weaker, stronger: Math.max(first, second), order: KIND_ORDER[kind], name: fold(via.name), id: via.id,
      });
    } else if (sameCompany && first >= RANK.know) {
      out.push({
        view: {
          kind, via: { id: via.id, name: via.name }, confirmed: false, strength: 'cold',
          line: `Possible path, not confirmed: ${via.name} also works at ${target.role?.company}, and ${knowWords(tie.band, via.name)}. Chausar sees nothing that shows ${firstName(via.name)} knows ${firstName(target.name)}.`,
        },
        confirmed: false, weaker: -1, stronger: first, order: KIND_ORDER[kind], name: fold(via.name), id: via.id,
      });
    }
  }
  out.sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || b.weaker - a.weaker || b.stronger - a.stronger || a.order - b.order
    || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out.slice(0, limit).map(item => item.view);
}

/** The strongest warm path to one person, or null: what a pipeline card or a search result shows. */
export function bestPath(index: PathIndex, personId: string): WarmPathView | null {
  return warmPaths(index, personId, 1)[0] ?? null;
}
