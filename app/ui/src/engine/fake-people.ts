/**
 * The fake engine's answers for the owner's network (Ink v2 wave 4, package 4D4), as the engine's 4D1 to 4D3 give them
 * (platform/runtime/venture/network/*): the people, one person's sheet, the source cards and the bands, the import
 * with its Check and Undo, split, hide and Forget, the plain-words search with Find more and Save search, and "Before
 * you write". Same codes, shapes, order and words as the engine; the people and files below are samples of this fake.
 *
 * Two answers outside the network desk ride here because the Network tab calls them: venture.pipeline.add (4E1; a
 * card at Found, which 4E4 builds the pipeline on) and workspace.custody.neverContactReset (4J6; the fake's list always
 * checks, so it answers NEVER_CONTACT_OK, as the engine does for a list that still works).
 *
 * The fake reads plain words with a small table instead of the owner's AI: it is a sample, never a model.
 */

import {
  EngineError, type ChatConsentView, type NetworkImportKind, type NetworkImportResult, type NetworkImportView, type NetworkSearchView, type NetworkSourcesView, type PeopleView,
  type PersonSummary, type PersonView, type PipelineCardView, type PipelineStage, type ReceiptLite, type SearchResultView, type SearchWebState, type TieBand,
  type WarmPathView,
} from './types';
import type { W4DeskHost } from './fake-w4';

export const FAKE_4D4_METHODS: readonly string[] = [
  'venture.network.import', 'venture.network.importUndo', 'venture.network.split', 'venture.network.forget', 'venture.network.hide',
  'venture.network.people', 'venture.network.person', 'venture.network.sources', 'venture.network.search', 'venture.network.searchMore',
  'venture.network.saveSearch', 'venture.network.research', 'venture.pipeline.add', 'workspace.custody.neverContactReset',
];

const KINDS: readonly NetworkImportKind[] = ['linkedin-connections', 'linkedin-messages', 'contacts-csv', 'vcard', 'calendar-ics', 'mail-headers'];
const KIND_LABEL: Readonly<Record<NetworkImportKind, string>> = {
  'linkedin-connections': 'LinkedIn connections', 'linkedin-messages': 'LinkedIn messages', 'contacts-csv': 'Contacts file', vcard: 'Phone contacts',
  'calendar-ics': 'Calendar', 'mail-headers': 'Mail headers',
};
const REFRESH: Readonly<Record<NetworkImportKind, string>> = {
  'linkedin-connections': 'Download a new copy to catch new connections.', 'linkedin-messages': 'Download a new copy to catch new messages.',
  'contacts-csv': 'Export a new copy to catch new contacts.', vcard: 'Export a new copy to catch new contacts.',
  'calendar-ics': 'Export a new copy to catch new meetings.', 'mail-headers': 'Export a new copy to catch new mail.',
};
const BANDS: readonly TieBand[] = ['close', 'know-well', 'know', 'met-once', 'cold'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STAGE_LABEL: Readonly<Record<PipelineStage, string>> = { found: 'Found', asked: 'Asked', talking: 'Talking', proposal: 'Proposal', won: 'Won', lost: 'Lost', 'not-now': 'Not now' };

const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
const PAGE_SIZE = 30;
const HOSTED_IMPORT = 'Import your network in the desktop app. It reads the file on your computer.';
const PROTECTED_LINE = 'Chausar does not search people by religion, caste, health, age, gender, sexual orientation or family role. Ask about their work instead: their role, their company, what they sell or how you know them.';
const NOT_SET_UP = 'Web search is not set up here.';
const CHECK_LINE = 'A one-way check of their email, phone and LinkedIn address, made with a key that never leaves this business\'s lock, so a file you import later leaves them out. It cannot be turned back into an address.';
const SHARED_CHECK_LINE = "A second one-way check, made with this computer's key, stops every business on this computer from drafting to them.";
const BACKUPS_LINE = 'Backups made before now still hold this person until those backups are deleted.';
const PROTECTED = /\b(religion|religious|caste|health|illness|disease|disabled|age|aged|gender|male|female|sexual|gay|lesbian|married|single mothers?|hindu|muslim|christian|sikh|jain|brahmin|dalit)\b|धर्म|जाति|उम्र|लिंग|स्वास्थ्य|बीमारी/iu;

const count = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const initials = (name: string) => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join('');
const fold = (value: string | null | undefined) => (value ?? '').toLocaleLowerCase('en-IN').replace(/\s+/g, ' ').trim();
/** "21 Oct 2026", the engine's day-month-year order for India. */
const dayWords = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d} ${MONTHS[Number(m) - 1]} ${y}`; };
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000);

interface Fact { field: string; value: string; source: string; sourceId: string; importId: string | null; identity: boolean }
interface Person {
  id: string; name: string; title: string | null; company: string | null; place: string | null;
  emails: string[]; linkedin: string | null; hidden: boolean; band: TieBand | null; how: string[]; paths: WarmPathView[];
  facts: Fact[]; notes: string[]; clientId: string | null; web: { text: string; url: string }[];
}
interface ImportRecord { id: string; kind: NetworkImportKind; fileName: string; at: string; rows: number; people: number; merged: number; dropped: { what: string; count: number }[]; undone: string | null; digest: string; made: string[] }
interface SearchRecord { id: string; text: string; traits: Trait[]; ranked: SearchResultView[]; shown: number; saved: string | null; web: SearchWebState; webLine: string | null; summary: string }
interface Trait { id: string; label: string; test: RegExp; fields: ('title' | 'company' | 'place' | 'note')[] }
interface Network { people: Person[]; imports: ImportRecord[]; searches: SearchRecord[]; cards: PipelineCardView[] }

/** Where a fact came from, in the engine's words: "LinkedIn connections, Connections.csv, line 14". */
const fromFile = (importId: string, kind: NetworkImportKind, fileName: string, row?: number) => ({
  source: row === undefined ? `${KIND_LABEL[kind]}, ${fileName}` : `${KIND_LABEL[kind]}, ${fileName}, line ${count(row)}`,
  sourceId: row === undefined ? importId : `${importId}:${row}`, importId,
});
const LI = (row: number) => fromFile('netimport_li', 'linkedin-connections', 'Connections.csv', row);
const VCF = (row: number) => fromFile('netimport_vcf', 'vcard', 'contacts.vcf', row);
const MAIL = () => fromFile('netimport_mbox', 'mail-headers', 'takeout-mail.mbox');
const ICS = () => fromFile('netimport_ics', 'calendar-ics', 'work.ics');
const fact = (field: string, value: string, from: { source: string; sourceId: string; importId: string }, identity = false): Fact => ({ field, value, ...from, identity });

const direct = (band: TieBand, name: string): WarmPathView => {
  const first = firstName(name);
  const line = band === 'close' ? `You know ${first} directly, and closely.` : band === 'know-well' ? `You know ${first} directly, well.`
    : band === 'know' ? `You know ${first} directly.` : band === 'met-once' ? `You have met ${first}.` : `${first} is in your network, but Chausar sees little between you.`;
  return { kind: 'direct', via: null, confirmed: true, strength: band, line };
};

/** The sample network of the open sample business (Lumen Studio): imported files and the people they gave. */
function sampleNetwork(): Network {
  const imports: ImportRecord[] = [
    { id: 'netimport_vcf', kind: 'vcard', fileName: 'contacts.vcf', at: '2026-08-10T06:00:00.000Z', rows: 6, people: 4, merged: 0, dropped: [{ what: 'Photos', count: 4 }, { what: 'Notes', count: 3 }], undone: null, digest: 'vcf', made: [] },
    { id: 'netimport_ics', kind: 'calendar-ics', fileName: 'work.ics', at: '2026-10-19T03:30:00.000Z', rows: 52, people: 0, merged: 3, dropped: [{ what: 'Event descriptions', count: 41 }], undone: null, digest: 'ics', made: [] },
    { id: 'netimport_mbox', kind: 'mail-headers', fileName: 'takeout-mail.mbox', at: '2026-10-20T08:00:00.000Z', rows: 1840, people: 0, merged: 4, dropped: [], undone: null, digest: 'mbox', made: [] },
    { id: 'netimport_li', kind: 'linkedin-connections', fileName: 'Connections.csv', at: '2026-10-21T04:30:00.000Z', rows: 9, people: 5, merged: 2, dropped: [{ what: 'Rows with no email, phone or profile link', count: 2 }], undone: null, digest: 'li', made: [] },
  ];
  const people: Person[] = [
    {
      id: 'person_tara', name: 'Tara Iyer', title: 'Brand partnerships lead', company: 'Kettle Audio', place: 'Mumbai', emails: ['tara@kettleaudio.example'],
      linkedin: 'https://www.linkedin.com/in/tara-iyer-kettle', hidden: false, band: 'know-well',
      how: ['11 emails both ways, the last on 14 Oct (Mail headers, takeout-mail.mbox)', 'A LinkedIn connection since 2023 (LinkedIn connections, Connections.csv)'],
      paths: [direct('know-well', 'Tara Iyer')],
      facts: [
        fact('Name', 'Tara Iyer', LI(14), true), fact('Role', 'Brand partnerships lead, Kettle Audio', LI(14)), fact('LinkedIn', 'https://www.linkedin.com/in/tara-iyer-kettle', LI(14), true),
        fact('Email', 'tara@kettleaudio.example', LI(14), true), fact('Mail', '11 emails both ways, 2 Mar 2026 to 14 Oct 2026', MAIL()),
      ],
      notes: ['Sponsored two mic reviews in 2025'], clientId: null, web: [],
    },
    {
      id: 'person_kabir', name: 'Kabir Sethi', title: 'Founder', company: 'Kettle Audio', place: 'Mumbai', emails: [], linkedin: 'https://www.linkedin.com/in/kabir-sethi',
      hidden: false, band: 'met-once', how: ['1 small meeting, on 9 Sep (Calendar, work.ics)', 'A LinkedIn connection since 2024 (LinkedIn connections, Connections.csv)'],
      paths: [
        { kind: 'same-company', via: { id: 'person_tara', name: 'Tara Iyer' }, confirmed: true, strength: 'know', line: 'Through Tara Iyer, also at Kettle Audio: you know Tara well, and Tara and Kabir were in a small meeting together (Calendar, work.ics).' },
        direct('met-once', 'Kabir Sethi'),
      ],
      facts: [
        fact('Name', 'Kabir Sethi', LI(22), true), fact('Role', 'Founder, Kettle Audio', LI(22)), fact('LinkedIn', 'https://www.linkedin.com/in/kabir-sethi', LI(22), true),
        fact('Meetings', '1 meeting, on 9 Sep 2026: "Kettle x Lumen sponsor call"', ICS()),
      ],
      notes: ['Kettle x Lumen sponsor call'], clientId: null, web: [],
    },
    {
      id: 'person_arjun', name: 'Arjun Kulkarni', title: 'Sales manager', company: 'Pocket Audio', place: 'Pune', emails: ['arjun.k@pocketaudio.example'], linkedin: null,
      hidden: false, band: 'know', how: ['Saved in your phone (Phone contacts, contacts.vcf)', '3 emails both ways, the last on 2 Oct (Mail headers, takeout-mail.mbox)'],
      paths: [direct('know', 'Arjun Kulkarni')],
      facts: [
        fact('Name', 'Arjun Kulkarni', VCF(3), true), fact('Role', 'Sales manager, Pocket Audio', VCF(3)), fact('Email', 'arjun.k@pocketaudio.example', VCF(3), true),
        fact('Phone', '+919820012345', VCF(3), true), fact('Saved contact', 'In your phone contacts', VCF(3)), fact('Mail', '3 emails both ways, 18 Aug 2026 to 2 Oct 2026', MAIL()),
      ],
      notes: [], clientId: null, web: [],
    },
    {
      id: 'person_nisha', name: 'Nisha Rao', title: 'Head of marketing', company: 'Pocket Audio', place: 'Pune', emails: [], linkedin: 'https://www.linkedin.com/in/nisha-rao-pocket',
      hidden: false, band: 'cold', how: ['A LinkedIn connection since 2022 (LinkedIn connections, Connections.csv)'],
      paths: [
        direct('cold', 'Nisha Rao'),
        { kind: 'same-company', via: { id: 'person_arjun', name: 'Arjun Kulkarni' }, confirmed: false, strength: 'cold', line: 'Possible path, not confirmed: Arjun Kulkarni also works at Pocket Audio, and you know Arjun. Chausar sees nothing that shows Arjun knows Nisha.' },
      ],
      facts: [
        fact('Name', 'Nisha Rao', LI(31), true), fact('Role', 'Head of marketing, Pocket Audio', LI(31)), fact('LinkedIn', 'https://www.linkedin.com/in/nisha-rao-pocket', LI(31), true),
        fact('LinkedIn connection', 'Connected on 4 Feb 2022', LI(31)),
      ],
      notes: [], clientId: null, web: [],
    },
    {
      id: 'person_leela', name: 'Leela Menon', title: 'Freelance video editor', company: null, place: 'Bengaluru', emails: ['leela.edits@mail.example'], linkedin: null,
      hidden: false, band: 'close',
      how: ['23 emails both ways, the last on 20 Oct (Mail headers, takeout-mail.mbox)', '4 small meetings, the last on 9 Oct (Calendar, work.ics)', 'Saved in your phone (Phone contacts, contacts.vcf)'],
      paths: [direct('close', 'Leela Menon')],
      facts: [
        fact('Name', 'Leela Menon', VCF(1), true), fact('Role', 'Freelance video editor', VCF(1)), fact('Email', 'leela.edits@mail.example', VCF(1), true),
        fact('Saved contact', 'In your phone contacts', VCF(1)), fact('Mail', '23 emails both ways, 6 Jan 2026 to 20 Oct 2026', MAIL()),
        fact('Meetings', '4 meetings, 2 Jul 2026 to 9 Oct 2026', ICS()),
      ],
      notes: ['Edits the long videos'], clientId: null, web: [],
    },
    {
      id: 'person_vikram', name: 'Vikram Bhat', title: 'Co-founder', company: 'Doodle Desk Studio', place: 'Bengaluru', emails: [], linkedin: 'https://www.linkedin.com/in/vikram-bhat-doodle',
      hidden: false, band: 'cold', how: ['A LinkedIn connection since 2021 (LinkedIn connections, Connections.csv)'],
      paths: [
        { kind: 'connector', via: { id: 'person_leela', name: 'Leela Menon' }, confirmed: true, strength: 'know', line: 'Through Leela Menon: you know Leela closely, and you said Leela knows Vikram: they edited a show together.' },
        direct('cold', 'Vikram Bhat'),
      ],
      facts: [
        fact('Name', 'Vikram Bhat', LI(40), true), fact('Role', 'Co-founder, Doodle Desk Studio', LI(40)), fact('LinkedIn', 'https://www.linkedin.com/in/vikram-bhat-doodle', LI(40), true),
        fact('Knows', 'Leela Menon, you said: they edited a show together', { source: 'You, in Chausar', sourceId: 'owner', importId: '' }),
      ],
      notes: ['Makes explainer videos for brands'], clientId: null, web: [],
    },
    {
      id: 'person_pooja', name: 'Pooja Nair', title: 'Head of content', company: 'Nimbus Mics', place: 'Pune', emails: ['pooja@nimbusmics.example'], linkedin: null,
      hidden: false, band: 'know', how: ['Nimbus Mics paid you, the last invoice on 19 Oct (Your clients in Chausar)', '5 emails both ways, the last on 19 Oct (Mail headers, takeout-mail.mbox)'],
      paths: [direct('know', 'Pooja Nair')],
      facts: [
        fact('Name', 'Pooja Nair', VCF(5), true), fact('Role', 'Head of content, Nimbus Mics', VCF(5)), fact('Email', 'pooja@nimbusmics.example', VCF(5), true),
        fact('Client', 'Nimbus Mics, in your clients', { source: 'Your clients in Chausar', sourceId: 'client', importId: '' }), fact('Mail', '5 emails both ways, 3 Sep 2026 to 19 Oct 2026', MAIL()),
      ],
      notes: [], clientId: 'c-nimbus', web: [],
    },
    {
      id: 'person_dev', name: 'Dev Malhotra', title: 'Founder', company: 'Saffron Leaf Organics', place: 'Pune', emails: [], linkedin: 'https://www.linkedin.com/in/dev-malhotra-saffron',
      hidden: false, band: 'cold', how: ['A LinkedIn connection since 2020 (LinkedIn connections, Connections.csv)'],
      paths: [direct('cold', 'Dev Malhotra')],
      facts: [
        fact('Name', 'Dev Malhotra', LI(47), true), fact('Role', 'Founder, Saffron Leaf Organics', LI(47)), fact('LinkedIn', 'https://www.linkedin.com/in/dev-malhotra-saffron', LI(47), true),
      ],
      notes: ['Sells skincare online'], clientId: null, web: [],
    },
    {
      id: 'person_sana', name: 'Sana Qureshi', title: 'Creator partnerships', company: 'Boat Audio', place: 'Mumbai', emails: ['sana.q@boataudio.example'],
      linkedin: 'https://www.linkedin.com/in/sana-qureshi', hidden: false, band: 'met-once',
      how: ['Saved in your phone (Phone contacts, contacts.vcf)', 'A LinkedIn connection since 2024 (LinkedIn connections, Connections.csv)'],
      paths: [direct('met-once', 'Sana Qureshi')],
      facts: [
        fact('Name', 'Sana Qureshi', LI(53), true), fact('Role', 'Creator partnerships, Boat Audio', LI(53)), fact('LinkedIn', 'https://www.linkedin.com/in/sana-qureshi', LI(53), true),
        fact('Name', 'Sana Q', VCF(6), true), fact('Email', 'sana.q@boataudio.example', VCF(6), true), fact('Saved contact', 'In your phone contacts', VCF(6)),
      ],
      notes: [], clientId: null, web: [],
    },
  ];
  return { people, imports, searches: [], cards: [] };
}

/** The fake's reading of plain words: a few traits it knows, each with the fields that can show it. */
const TRAIT_TABLE: readonly { words: RegExp; label: string; test: RegExp; fields: Trait['fields'] }[] = [
  { words: /\b(founders?|owners?|co-?founders?)\b|संस्थापक|मालिक/iu, label: 'Founder or owner', test: /founder|owner/i, fields: ['title'] },
  { words: /\b(brand|brands|marketing|partnerships?|sponsors?|sponsorships?)\b|ब्रांड|मार्केटिंग|स्पॉन्सर/iu, label: 'Works on brand deals or marketing', test: /brand|marketing|partnership/i, fields: ['title'] },
  { words: /\b(audio|mics?|microphones?|headphones?)\b|ऑडियो|माइक/iu, label: 'Works in audio', test: /audio|mic/i, fields: ['company'] },
  { words: /\b(editors?|editing|video|videos)\b|एडिटर|वीडियो/iu, label: 'Edits or makes video', test: /editor|video/i, fields: ['title', 'note'] },
  { words: /\b(skincare|skin care|beauty)\b|स्किनकेयर/iu, label: 'Sells skincare online', test: /skincare/i, fields: ['note'] },
  { words: /\bpune\b|पुणे/iu, label: 'Based in Pune', test: /pune/i, fields: ['place'] },
  { words: /\bmumbai\b|मुंबई/iu, label: 'Based in Mumbai', test: /mumbai/i, fields: ['place'] },
  { words: /\b(bengaluru|bangalore)\b|बेंगलुरु/iu, label: 'Based in Bengaluru', test: /bengaluru/i, fields: ['place'] },
];

export class FakePeopleDesk {
  private readonly host: W4DeskHost;
  private readonly networks = new Map<string, Network>();
  private seq = 0;

  constructor(host: W4DeskHost, options: { fresh?: boolean } = {}) {
    this.host = host;
    if (!options.fresh) this.networks.set('lumen', sampleNetwork());
  }

  /** The tie and band receipts this desk serves, for venture.receipt.get. */
  receipt(id: string): ReceiptLite | undefined {
    const network = this.network();
    if (id === this.bandsReceiptId()) {
      const bands = this.bandCounts(network);
      return {
        id, at: this.host.now(), figures: [], stale: false,
        explanation: `How many people sit in each band, counted by Chausar's code from the ties it worked out: ${BANDS.map((band, i) => `${count(bands[i]!)} ${bandWord(band)}`).join(', ')}.`,
      };
    }
    const person = network.people.find((item) => `tie_${item.id}` === id);
    if (!person || !person.band) return undefined;
    const found = person.how.length ? `${person.how.join('. ')}.` : 'Nothing in your files or records shows how you know them yet.';
    return {
      id, at: this.host.now(), figures: [], stale: false,
      explanation: `How well you know ${person.name}, worked out by Chausar's code from your own files and records, never by AI. ${found} That is ${bandWord(person.band)}. Chausar's own weights; tuned later from your outcomes. Each signal fades by half every 180 days, Chausar's own choice.`,
    };
  }

  /** Internal privacy hook: identities needed to erase sales drafts, never sent to a screen. */
  privacyFacts(): { id: string; names: string[]; clientId: string | null; emails: string[]; phones: string[]; urls:string[] }[] {
    return this.network().people.map(person => ({ id: person.id, names: [person.name, ...person.facts.filter(fact => fact.field === 'Name').map(fact => fact.value)], clientId: person.clientId, emails: [...person.emails], phones: person.facts.filter(fact => fact.field === 'Phone').map(fact => fact.value), urls:[...new Set([person.linkedin,...person.facts.filter(fact=>fact.field==='LinkedIn').map(fact=>fact.value)].filter((value):value is string=>typeof value==='string'&&!!value))] }));
  }
  /** The pipeline cards this desk made with venture.pipeline.add (4E4 builds the pipeline on them). */
  cards(): PipelineCardView[] {
    return structuredClone(this.network().cards);
  }

  /** 4E4: the open business's pipeline cards themselves, not copies: the pipeline desk (fake-pipeline.ts) keeps them current. */
  liveCards(): PipelineCardView[] {
    return this.network().cards;
  }

  /** 4E4: what the pipeline desk reads about one person: who, how well you know them, their addresses and paths. */
  contact(id: string): { id: string; name: string; company: string | null; band: TieBand | null; emails: string[]; phone: string | null; linkedin: string | null; paths: WarmPathView[] } | null {
    const person = this.network().people.find((item) => item.id === id);
    if (!person) return null;
    return { id: person.id, name: person.name, company: person.company, band: person.band, emails: [...person.emails], phone: person.facts.find((item) => item.field === 'Phone')?.value ?? null, linkedin: person.linkedin, paths: structuredClone(person.paths) };
  }

  /** 4E4: everyone in the open business's network, as contact() reads them. */
  allContacts() {
    return this.network().people.map((person) => this.contact(person.id)!);
  }

  request(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'venture.network.people': return this.people(p);
      case 'venture.network.person': return this.personView(this.find(String(p.id ?? '')));
      case 'venture.network.sources': return this.sources();
      case 'venture.network.hide': return this.hide(p);
      case 'venture.network.split': return this.split(p);
      case 'venture.network.forget': return this.forget(p);
      case 'venture.network.import': return this.importFile(p);
      case 'venture.network.importUndo': return this.undo(p);
      case 'venture.network.search': return this.search(p);
      case 'venture.network.searchMore': return this.searchMore(p);
      case 'venture.network.saveSearch': return this.saveSearch(p);
      case 'venture.network.research': return this.research(p);
      case 'venture.pipeline.add': return this.addCard(p);
      case 'workspace.custody.neverContactReset': return this.neverContactReset(p);
      default: throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------------------------------------------

  private network(): Network {
    const id = this.host.current();
    let network = this.networks.get(id);
    if (!network) { network = { people: [], imports: [], searches: [], cards: [] }; this.networks.set(id, network); }
    return network;
  }

  private bandsReceiptId(): string {
    return `R-0480-${this.host.current()}`;
  }

  private find(id: string): Person {
    const person = this.network().people.find((item) => item.id === id);
    if (!person) throw new EngineError('INVALID_VENTURE_REQUEST', 'This person is not in your network.');
    return person;
  }

  private summary(person: Person): PersonSummary {
    const band = person.band;
    return {
      id: person.id, name: person.name, initials: initials(person.name), title: person.title, company: person.company,
      band, dots: band ? BANDS.length - BANDS.indexOf(band) : 0, hidden: person.hidden, degree: '1st',
    };
  }

  private people(p: Record<string, unknown>): PeopleView {
    const query = typeof p.query === 'string' && p.query !== '' ? fold(p.query) : null;
    const hidden = p.hidden === true;
    if (p.limit !== undefined && !(Number.isSafeInteger(p.limit) && (p.limit as number) >= 0 && (p.limit as number) <= 500)) {
      throw new EngineError('INVALID_VENTURE_REQUEST', 'limit is a whole number from 0 to 500.');
    }
    const limit = p.limit === undefined ? 500 : (p.limit as number);
    const matched = this.network().people
      .filter((person) => person.hidden === hidden)
      .filter((person) => !query || fold(person.name).includes(query) || fold(person.company).includes(query) || fold(person.title).includes(query) || person.emails.some((email) => email.includes(query)))
      .sort((a, b) => (fold(a.name) < fold(b.name) ? -1 : fold(a.name) > fold(b.name) ? 1 : 0));
    return { people: matched.slice(0, limit).map((person) => this.summary(person)), suggestions: [], total: matched.length, consent: this.consentNeeded() };
  }

  private personView(person: Person): PersonView {
    const identities = new Set(person.facts.filter((item) => item.identity).map((item) => item.sourceId.split(':')[0]));
    return {
      person: this.summary(person),
      fields: person.facts.map((item) => ({ field: item.field, value: item.value, source: item.source, sourceId: item.sourceId })),
      how: person.band ? (person.how.length ? person.how : [`Nothing in your files shows how you know ${firstName(person.name)} yet.`]).map((line) => ({ line, receiptId: `tie_${person.id}` })) : [],
      paths: structuredClone(person.paths), card: structuredClone(this.network().cards.find((card) => card.personId === person.id) ?? null), drafts: [],
      merged: identities.size > 1, web: structuredClone(person.web), linkedin: person.linkedin,
    };
  }

  private bandCounts(network: Network): number[] {
    return BANDS.map((band) => network.people.filter((person) => person.band === band).length);
  }

  private sources(): NetworkSourcesView {
    const network = this.network();
    const today = this.host.now();
    const sources: NetworkSourcesView['sources'] = [];
    for (const kind of KINDS) {
      const ofKind = network.imports.filter((record) => record.kind === kind && !record.undone);
      const newest = ofKind[ofKind.length - 1];
      if (!newest) continue;
      const ids = new Set(ofKind.map((record) => record.id));
      const kept = network.people.filter((person) => person.facts.some((item) => item.importId && ids.has(item.importId))).length;
      const age = daysBetween(newest.at, today);
      sources.push({
        kind, fileName: newest.fileName, at: newest.at, kept, dropped: newest.dropped.reduce((sum, item) => sum + item.count, 0),
        line: `${plural(kept, 'person', 'people')}, imported ${dayWords(newest.at)}.`,
        stale: age > 60 ? `Imported ${Math.floor(age / 30)} months ago. ${REFRESH[kind]}` : null,
      });
    }
    // No web search is composed in this fake, as in the engine without one.
    const webSearch = 'not-set-up' as const;
    if (!network.people.some((person) => person.band)) return { sources, bands: null, webSearch, mailbox: null, calendar: null };
    const counts = this.bandCounts(network);
    const total = counts.reduce((sum, n) => sum + n, 0);
    const share = (n: number) => (total ? Math.floor((n * 1000) / total) : 0);
    const [close, knowWell, know, metOnce, cold] = counts;
    const permille = { close: share(close!), knowWell: share(knowWell!), know: share(know!), metOnce: share(metOnce!), cold: share(cold!) };
    return { sources, bands: { close: close!, knowWell: knowWell!, know: know!, metOnce: metOnce!, cold: cold!, receiptId: this.bandsReceiptId(), permille }, webSearch, mailbox: null, calendar: null };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Hide, split, Forget
  // ---------------------------------------------------------------------------------------------------------------

  private hide(p: Record<string, unknown>): { person: PersonSummary } {
    if (typeof p.hidden !== 'boolean') throw new EngineError('INVALID_VENTURE_REQUEST', 'hidden is true or false.');
    const person = this.find(String(p.personId ?? ''));
    person.hidden = p.hidden;
    return { person: this.summary(person) };
  }

  private split(p: Record<string, unknown>) {
    const person = this.find(String(p.personId ?? ''));
    const ids = Array.isArray(p.sourceIds) ? new Set(p.sourceIds.map(String)) : new Set<string>();
    if (ids.size < 1 || ids.size > 200) throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose the sources to move, from 1 to 200.');
    for (const id of ids) if (!person.facts.some((item) => item.sourceId === id)) throw new EngineError('INVALID_VENTURE_REQUEST', 'One of those sources is not this person\'s.');
    const moving = person.facts.filter((item) => ids.has(item.sourceId));
    const staying = person.facts.filter((item) => !ids.has(item.sourceId));
    if (!moving.some((item) => item.identity) || !staying.some((item) => item.identity)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose some of this person\'s sources, not all of them.');
    person.facts = staying;
    const name = moving.find((item) => item.field === 'Name')?.value ?? person.name;
    const moved: Person = {
      ...structuredClone(person), id: `person_split_${(this.seq += 1)}`, name, facts: moving, band: 'cold',
      emails: moving.filter((item) => item.field === 'Email').map((item) => item.value), linkedin: moving.find((item) => item.field === 'LinkedIn')?.value ?? null,
      how: [], paths: [direct('cold', name)], web: [],
    };
    person.emails = staying.filter((item) => item.field === 'Email').map((item) => item.value);
    this.network().people.push(moved);
    return { person: this.personView(person), split: this.personView(moved) };
  }

  private forget(p: Record<string, unknown>): { line: string; kept: string[] } {
    const network = this.network();
    const person = this.find(String(p.id ?? ''));
    const first = firstName(person.name);
    let kept: string[] = [];
    let line = `Chausar forgot ${first}. A file you import later leaves ${first} out.`;
    if (person.clientId) {
      const invoices = (this.host.ask('venture.invoice.list', {}) as { clientId?: string }[]).filter((invoice) => invoice.clientId === person.clientId).length;
      kept = invoices > 0 ? ['The client record, for the invoices', plural(invoices, 'invoice', 'invoices')] : ['The client record, in Clients'];
      line = invoices > 0 ? `${first} is your client. ${first}'s invoices stay; everything else Chausar kept about ${first} is gone.`
        : `${first} is your client, so the client record stays in Clients; everything else Chausar kept about ${first} is gone.`;
    }
    network.people = network.people.filter((item) => item.id !== person.id);
    network.cards = network.cards.filter((card) => card.personId !== person.id);
    for (const search of network.searches) search.ranked = search.ranked.filter((result) => result.person?.id !== person.id);
    const shared = this.host.hosted() ? [] : [SHARED_CHECK_LINE];
    return { line, kept: [...kept, CHECK_LINE, ...shared, BACKUPS_LINE] };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Import, Check and Undo
  // ---------------------------------------------------------------------------------------------------------------

  private importFile(p: Record<string, unknown>): NetworkImportResult {
    if (this.host.hosted()) throw new EngineError('TIER_UNAVAILABLE', HOSTED_IMPORT);
    const kind = p.kind as NetworkImportKind;
    if (typeof p.kind !== 'string' || !KINDS.includes(kind)) {
      throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose one of the files Chausar reads: LinkedIn connections or messages, a contacts CSV or vCard, a calendar file or a mail export.');
    }
    const fileName = String(p.name ?? '').split(/[\\/]/).pop() ?? '';
    if (!fileName) throw new EngineError('INVALID_VENTURE_REQUEST', 'The file name is required.');
    if (typeof p.text !== 'string') throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the file as text.');
    const text = p.text;
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > MAX_IMPORT_BYTES) {
      const tenths = Math.round((bytes * 10) / 1_048_576);
      throw new EngineError('NETWORK_FILE_TOO_LARGE', `This file is ${Math.floor(tenths / 10)}.${tenths % 10} MB; Chausar reads at most 4 MB at once. Export a smaller part and import each one.`);
    }
    if (!text.trim()) throw new EngineError('NETWORK_FILE_INVALID', 'Line 1: the file is empty. Nothing was imported.');
    const network = this.network();
    const digest = `${kind}\n${text}`;
    const before = network.imports.find((record) => record.digest === digest && !record.undone);
    if (before) throw new EngineError('NETWORK_ALREADY_IMPORTED', `You already imported this file on ${dayWords(before.at)} (${before.fileName}). Chausar keeps each file once.`);
    const read = readFile(kind, text);
    const importId = p.check === true ? 'netimport_check' : `netimport_${(this.seq += 1)}`;
    const plan = this.plan(network, read.entries, kind, fileName, importId);
    const droppedWords = read.dropped.length ? ` Dropped ${read.dropped.map((item) => (item.what === 'Message text' ? `message text, ${plural(item.count, 'line', 'lines')}` : `${item.what.toLowerCase()}, ${count(item.count)}`)).join('; ')}.` : '';
    const kept = plan.made.length + plan.merged.length;
    if (p.check === true) {
      return {
        mode: 'check', kept, dropped: read.dropped, people: plan.made.length, merged: plan.merged.length, samples: plan.samples,
        line: `Chausar would keep ${plural(kept, 'person', 'people')} from ${fileName}: ${count(plan.made.length)} new, ${count(plan.merged.length)} already in your network.${droppedWords} Nothing is saved until you import.`,
      };
    }
    for (const person of plan.made) network.people.push(person);
    for (const { person, facts } of plan.merged) person.facts.push(...facts);
    const record: ImportRecord = {
      id: importId, kind, fileName, at: this.host.now(), rows: read.rows, people: plan.made.length, merged: plan.merged.length, dropped: read.dropped,
      undone: null, digest, made: plan.made.map((person) => person.id),
    };
    network.imports.push(record);
    return {
      mode: 'import', import: this.importView(record),
      line: `Imported ${plural(kept, 'person', 'people')} from ${fileName}: ${count(plan.made.length)} new, ${count(plan.merged.length)} already in your network.${droppedWords}`,
    };
  }

  /** New people for entries no one here has, facts for the people an entry's email or LinkedIn address matches. */
  private plan(network: Network, entries: Entry[], kind: NetworkImportKind, fileName: string, importId: string) {
    const made: Person[] = [];
    const merged: { person: Person; facts: Fact[] }[] = [];
    const samples: { name: string; line: string }[] = [];
    for (const entry of entries) {
      const from = fromFile(importId, kind, fileName, entry.line);
      const facts = [
        fact('Name', entry.name, from, true),
        ...(entry.title || entry.company ? [fact('Role', [entry.title, entry.company].filter(Boolean).join(', '), from)] : []),
        ...entry.emails.map((email) => fact('Email', email, from, true)),
        ...(entry.linkedin ? [fact('LinkedIn', entry.linkedin, from, true)] : []),
      ];
      const known = [...network.people, ...made].find((person) => entry.emails.some((email) => person.emails.includes(email)) || (entry.linkedin !== null && person.linkedin === entry.linkedin));
      if (known) merged.push({ person: known, facts });
      else {
        made.push({
          id: `person_${(this.seq += 1)}`, name: entry.name, title: entry.title, company: entry.company, place: null, emails: entry.emails, linkedin: entry.linkedin,
          hidden: false, band: 'cold', how: kind === 'linkedin-connections' ? [`A LinkedIn connection (${from.source})`] : [], paths: [direct('cold', entry.name)],
          facts, notes: [], clientId: null, web: [],
        });
      }
      if (samples.length < 3) samples.push({ name: entry.name, line: entry.title ? [entry.title, entry.company].filter(Boolean).join(', ') : entry.emails[0] ?? entry.linkedin ?? '' });
    }
    return { made, merged, samples };
  }

  private importView(record: ImportRecord): NetworkImportView {
    const undone = record.undone ? ` Undone on ${dayWords(record.undone)}.` : '';
    return {
      id: record.id, kind: record.kind, fileName: record.fileName, at: record.at, rows: record.rows, people: record.people, merged: record.merged,
      dropped: structuredClone(record.dropped), undone: record.undone !== null,
      line: `${KIND_LABEL[record.kind]}, ${record.fileName}, imported ${dayWords(record.at)}: ${count(record.people)} new, ${count(record.merged)} already in your network.${undone}`,
    };
  }

  private undo(p: Record<string, unknown>) {
    const network = this.network();
    const record = network.imports.find((item) => item.id === p.importId);
    if (!record) throw new EngineError('INVALID_VENTURE_REQUEST', 'This import is not in this business.');
    if (record.undone) throw new EngineError('INVALID_VENTURE_REQUEST', 'This import was undone already.');
    const gone = network.people.filter((person) => record.made.includes(person.id));
    const goes = gone.flatMap((person) => (network.cards.some((card) => card.personId === person.id) ? [`${person.name}: a pipeline card`] : []));
    if (p.preview === true) {
      return {
        import: this.importView(record), removed: gone.length, goes, preview: true,
        line: `Undo would remove ${plural(gone.length, 'person', 'people')} this import brought in, and take off what it added to others.${goes.length ? ` Owner-made work goes with them: ${goes.join('; ')}.` : ''} Nothing has changed yet.`,
      };
    }
    network.people = network.people.filter((person) => !record.made.includes(person.id));
    for (const person of network.people) person.facts = person.facts.filter((item) => item.importId !== record.id);
    network.cards = network.cards.filter((card) => !record.made.includes(card.personId));
    record.undone = this.host.now();
    return {
      import: this.importView(record), removed: gone.length, goes, preview: false,
      line: `Undid ${record.fileName}: ${plural(gone.length, 'person', 'people')} it brought in ${gone.length === 1 ? 'is' : 'are'} gone, and what it added to others came off.${goes.length ? ` With them went ${goes.join('; ')}.` : ''}`,
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Search, Find more, Save search, Before you write
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * The chat consent while it is needed (needed or stale), as the people view carries it; null when it holds. The agents'
   * desk keeps it, when it answers; until then the sample business agreed when it was made.
   */
  private consentNeeded(): ChatConsentView | null {
    try {
      const team = this.host.ask('venture.team.list', {}) as { agents: { id: string; kind?: string }[] };
      const agent = team.agents.find((item) => item.kind !== 'code');
      if (!agent) return null;
      const consent = (this.host.ask('venture.agents.thread.list', { agent: agent.id }) as { consent?: ChatConsentView }).consent;
      return consent && (consent.state === 'needed' || consent.state === 'stale') ? consent : null;
    } catch {
      return null;
    }
  }

  /** The chat consent the engine checks before a search sends anything. */
  private requireConsent(): void {
    const consent = this.consentNeeded();
    if (consent?.state === 'needed') throw new EngineError('CHAT_CONSENT_REQUIRED', consent.text ?? '');
    if (consent?.state === 'stale') throw new EngineError('CHAT_CONSENT_STALE', `Your AI connection changed since you agreed, so chats wait until you agree again. ${consent.text ?? ''}`);
  }

  private search(p: Record<string, unknown>): NetworkSearchView {
    const text = typeof p.text === 'string' ? p.text.replace(/\s+/g, ' ').trim() : '';
    if (text.length < 2 || text.length > 2000) throw new EngineError('INVALID_VENTURE_REQUEST', 'The search is from 2 to 2,000 characters.');
    if (p.web !== undefined && typeof p.web !== 'boolean') throw new EngineError('INVALID_VENTURE_REQUEST', 'web is true or false.');
    if (PROTECTED.test(text)) throw new EngineError('NETWORK_TRAIT_PROTECTED', PROTECTED_LINE);
    this.requireConsent();
    const traits: Trait[] = TRAIT_TABLE.filter((row) => row.words.test(text)).slice(0, 5).map((row, i) => ({ id: `t${i + 1}`, label: row.label, test: row.test, fields: row.fields }));
    if (!traits.length) {
      throw new EngineError('INVALID_VENTURE_REQUEST', 'Chausar could not tell who you are looking for from these words. Say what they do, where they work or how you know them.');
    }
    const network = this.network();
    const ranked = network.people.filter((person) => !person.hidden).map((person) => this.result(person, traits)).filter((result) => result.fitBp > 0)
      .sort((a, b) => b.fitBp - a.fitBp || (b.person?.dots ?? 0) - (a.person?.dots ?? 0) || fold(a.person?.name) .localeCompare(fold(b.person?.name)));
    const web: SearchWebState = p.web === true ? 'not-set-up' : 'off';
    const knownWell = ranked.filter((result) => result.person && (result.person.band === 'close' || result.person.band === 'know-well')).length;
    const summary = ranked.length
      ? `${plural(ranked.length, 'person fits', 'people fit')}. Asked your AI 2 times · ${count(knownWell)} you know well · fit first, then path`
      : `No one in your network fits yet. Chausar read ${plural(network.people.length, 'person', 'people')}.`;
    const record: SearchRecord = {
      id: `netsearch_${(this.seq += 1)}`, text, traits, ranked, shown: Math.min(PAGE_SIZE, ranked.length), saved: null, web,
      webLine: web === 'not-set-up' ? `${NOT_SET_UP} Only your network was searched.` : null, summary,
    };
    network.searches.push(record);
    return this.searchView(record, record.ranked.slice(0, record.shown));
  }

  private searchView(record: SearchRecord, page: SearchResultView[]): NetworkSearchView {
    const cards = this.network().cards;
    return {
      id: record.id, text: record.text, traits: record.traits.map((trait) => ({ id: trait.id, label: trait.label })),
      results: structuredClone(page).map((result) => ({ ...result, inPipeline: cards.find((card) => card.personId === result.person?.id)?.stage ?? null })),
      summary: record.summary, more: record.shown < record.ranked.length, webLine: record.webLine, web: record.web,
    };
  }

  /** One person against the traits: each check quotes the field that holds it, or says not supported. */
  private result(person: Person, traits: Trait[]): SearchResultView {
    const fields: { field: Trait['fields'][number]; value: string; source: string }[] = [];
    const role = person.facts.find((item) => item.field === 'Role');
    if (person.title) fields.push({ field: 'title', value: person.title, source: role?.source ?? 'Your network' });
    if (person.company) fields.push({ field: 'company', value: person.company, source: role?.source ?? 'Your network' });
    if (person.place) fields.push({ field: 'place', value: person.place, source: role?.source ?? 'Your network' });
    for (const note of person.notes) fields.push({ field: 'note', value: note, source: 'Your note' });
    const checks = traits.map((trait) => {
      const hit = fields.find((item) => trait.fields.includes(item.field) && trait.test.test(item.value));
      return hit ? { trait: trait.label, check: 'yes' as const, quote: hit.value, source: hit.source, field: hit.field } : { trait: trait.label, check: 'not-supported' as const, quote: null, source: null, field: null };
    });
    const yes = checks.filter((item) => item.check === 'yes').length;
    const first = firstName(person.name);
    const clauses = checks.filter((item) => item.check === 'yes').slice(0, 2).map((item) => {
      if (item.field === 'title') return `${first}'s role reads "${item.quote}" (${item.source})`;
      if (item.field === 'company') return `${first}'s company reads "${item.quote}" (${item.source})`;
      if (item.field === 'place') return `${first}'s place reads "${item.quote}" (${item.source})`;
      return `your note on ${first} reads "${item.quote}" (${item.source})`;
    });
    return {
      person: this.summary(person), url: null, fitBp: Math.floor((yes * 10_000) / traits.length),
      why: clauses.length ? `Why: ${clauses.join('; ')}.` : 'Why: what you asked for, by the filters you set.',
      checks: checks.map(({ field: _field, ...rest }) => rest), path: structuredClone(person.paths[0] ?? null), inPipeline: null, cold: false,
      receiptId: person.band ? `tie_${person.id}` : null, linkedin: person.linkedin,
    };
  }

  private searchMore(p: Record<string, unknown>): NetworkSearchView {
    const record = this.network().searches.find((item) => item.id === p.searchId);
    if (!record) throw new EngineError('INVALID_VENTURE_REQUEST', 'This search is not in this business.');
    const from = record.shown;
    record.shown = Math.min(record.ranked.length, record.shown + PAGE_SIZE);
    return { ...this.searchView(record, record.ranked.slice(from, record.shown)), webLine: null, web: 'off' };
  }

  private saveSearch(p: Record<string, unknown>) {
    const record = this.network().searches.find((item) => item.id === p.searchId);
    if (!record) throw new EngineError('INVALID_VENTURE_REQUEST', 'This search is not in this business.');
    const name = typeof p.name === 'string' ? p.name.replace(/\s+/g, ' ').trim() : '';
    if (name.length < 1 || name.length > 60) throw new EngineError('INVALID_VENTURE_REQUEST', 'The name is from 1 to 60 characters.');
    record.saved = name;
    return { search: { id: record.id, name, at: this.host.now() } };
  }

  /** "Before you write": no web search is set up in this fake, as in the engine without one. */
  private research(p: Record<string, unknown>) {
    this.find(String(p.personId ?? ''));
    return { lines: [], line: NOT_SET_UP, web: 'not-set-up' as const };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The pipeline card and the never-contact list
  // ---------------------------------------------------------------------------------------------------------------

  private addCard(p: Record<string, unknown>): { card: PipelineCardView; line: string } {
    const trigger = p.trigger as { kind?: string; ref?: string } | undefined;
    if (!trigger || typeof trigger.kind !== 'string') throw new EngineError('PIPELINE_TRIGGER_REQUIRED', 'No source, no lead. Say where this person came from.');
    const person = this.find(String(p.personId ?? ''));
    const network = this.network();
    const already = network.cards.find((card) => card.personId === person.id);
    if (already) return { card: structuredClone(already), line: `Already in your pipeline, at ${STAGE_LABEL[already.stage]}.` };
    const search = trigger.kind === 'search' ? network.searches.find((item) => item.id === trigger.ref) : undefined;
    const business = this.host.businesses?.().find((item) => item.id === this.host.current())?.name ?? this.host.current();
    const card: PipelineCardView = {
      id: `opp_${(this.seq += 1)}`, personId: person.id, name: person.name, initials: initials(person.name), company: person.company, stage: 'found',
      band: person.band, dots: this.summary(person).dots, path: structuredClone(person.paths[0] ?? null), next: null, draft: null, business,
      trigger: search ? `From your search "${search.text.length > 60 ? `${search.text.slice(0, 59).trimEnd()}...` : search.text}"` : 'You added them.', score: null, timeline: [],
      draftId: null, draftChannel: null, outreach: [], basis: null, quote: null, client: null,
    };
    network.cards.push(card);
    this.host.emit({ type: 'pipeline.changed', businessId: this.host.current(), at: this.host.now() });
    return { card: structuredClone(card), line: 'Added to Found.' };
  }

  private neverContactReset(p: Record<string, unknown>): { line: string } {
    if (this.host.hosted()) throw new EngineError('TIER_UNAVAILABLE', 'This computer keeps no never-contact list.');
    const name = this.host.businesses?.().find((item) => item.id === this.host.current())?.name;
    if (typeof p.confirmation !== 'string' || p.confirmation !== name) throw new EngineError('CONFIRMATION_REQUIRED', 'Type the business name to start a new never-contact list.');
    throw new EngineError('NEVER_CONTACT_OK', 'Your never-contact list on this computer still checks, so there is nothing to start again.');
  }
}

const bandWord = (band: TieBand) => ({ close: 'Close', 'know-well': 'Know well', know: 'Know', 'met-once': 'Met once', cold: 'Cold' })[band];

// ---------------------------------------------------------------------------------------------------------------------
// The fake's file reader: the raw files the engine reads (LinkedIn's CSVs, a Google contacts CSV, a vCard, a calendar
// ICS), kept to the columns the engine keeps. Mail comes in only through the desktop app, as in the engine.
// ---------------------------------------------------------------------------------------------------------------------

interface Entry { line: number; name: string; title: string | null; company: string | null; emails: string[]; linkedin: string | null }

const invalid = (line: number, why: string) => new EngineError('NETWORK_FILE_INVALID', `Line ${count(line)}: ${why}. Nothing was imported.`);

/** One CSV line's cells: commas outside double quotes split; doubled quotes inside are one quote. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cell = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cell.trim()); cell = ''; } else cell += c;
  }
  out.push(cell.trim());
  return out;
}

function readFile(kind: NetworkImportKind, text: string): { rows: number; entries: Entry[]; dropped: { what: string; count: number }[] } {
  const lines = text.split(/\r?\n/);
  const dropped = new Map<string, number>();
  const drop = (what: string) => dropped.set(what, (dropped.get(what) ?? 0) + 1);
  const entries: Entry[] = [];
  let rows = 0;
  if (kind === 'mail-headers') {
    throw invalid(1, 'mail comes in only through the desktop app, which reads your mail export on your computer and keeps who wrote to whom and when');
  }
  if (kind === 'linkedin-connections' || kind === 'contacts-csv' || kind === 'linkedin-messages') {
    const at = lines.findIndex((line) => /first name|^name,|,name,|\bfrom\b/i.test(line));
    const header = at >= 0 ? cells(lines[at]!).map((cell) => cell.toLowerCase()) : [];
    const col = (name: string) => header.indexOf(name);
    if (kind === 'linkedin-connections' && (col('first name') < 0 || col('last name') < 0)) throw invalid(1, 'this is not LinkedIn\'s Connections file: it has no First Name and Last Name columns');
    if (kind === 'contacts-csv' && (col('name') < 0 || (col('e-mail 1 - value') < 0 && col('phone 1 - value') < 0))) throw invalid(at + 1 || 1, 'this does not look like a contacts file: it needs a Name column and an E-mail or Phone column');
    if (kind === 'linkedin-messages' && (col('from') < 0 || col('to') < 0 || col('date') < 0)) throw invalid(1, 'this is not LinkedIn\'s Messages file: it has no FROM, TO and DATE columns');
    for (let i = at + 1; i < lines.length; i++) {
      if (!lines[i]!.trim()) continue;
      const row = cells(lines[i]!);
      const cell = (name: string) => (col(name) >= 0 ? row[col(name)] ?? '' : '');
      rows += 1;
      if (row.length > header.length) throw invalid(i + 1, 'the row has more cells than the header');
      if (kind === 'linkedin-messages') {
        if (cell('content')) drop('Message text');
        if (!cell('date')) throw invalid(i + 1, 'the DATE could not be read');
        continue;
      }
      if (kind === 'linkedin-connections') {
        if (!cell('connected on')) throw invalid(i + 1, 'the Connected On date could not be read');
        const url = cell('url');
        const email = cell('email address').toLowerCase();
        if (!url && !email) { drop('Rows with no email, phone or profile link'); continue; }
        const name = `${cell('first name')} ${cell('last name')}`.replace(/\s+/g, ' ').trim();
        entries.push({ line: i + 1, name, title: cell('position') || null, company: cell('company') || null, emails: email ? [email] : [], linkedin: url || null });
      } else {
        if (cell('notes')) drop('Notes');
        const email = cell('e-mail 1 - value').toLowerCase();
        if (!email && !cell('phone 1 - value')) { drop('Rows with no email, phone or profile link'); continue; }
        entries.push({ line: i + 1, name: cell('name'), title: cell('organization 1 - title') || null, company: cell('organization 1 - name') || null, emails: email ? [email] : [], linkedin: null });
      }
    }
  } else if (kind === 'vcard') {
    if (!lines.some((line) => line.trim().toUpperCase() === 'BEGIN:VCARD')) throw invalid(1, 'this is not a vCard file: it has no BEGIN:VCARD line');
    let card: Entry | null = null;
    lines.forEach((raw, i) => {
      const line = raw.trim();
      const [key = '', ...rest] = line.split(':');
      const value = rest.join(':').trim();
      const name = key.split(';')[0]!.toUpperCase();
      if (name === 'BEGIN') { card = { line: i + 1, name: '', title: null, company: null, emails: [], linkedin: null }; rows += 1; return; }
      if (!card) return;
      const open: Entry = card;
      if (name === 'FN') open.name = value;
      else if (name === 'EMAIL') open.emails.push(value.toLowerCase());
      else if (name === 'ORG') open.company = value.split(';')[0] || null;
      else if (name === 'TITLE') open.title = value || null;
      else if (name === 'NOTE') drop('Notes');
      else if (name === 'PHOTO') drop('Photos');
      else if (name === 'END') { if (open.emails.length) entries.push(open); else drop('Rows with no email, phone or profile link'); card = null; }
    });
  } else if (kind === 'calendar-ics') {
    if (!lines.some((line) => line.trim().toUpperCase() === 'BEGIN:VCALENDAR')) throw invalid(1, 'this is not a calendar file: it has no BEGIN:VCALENDAR line');
    lines.forEach((raw, i) => {
      const line = raw.trim();
      if (line.toUpperCase() === 'BEGIN:VEVENT') rows += 1;
      if (line.toUpperCase().startsWith('DESCRIPTION')) drop('Event descriptions');
      const attendee = /^ATTENDEE[^:]*?(?:CN=([^;:]+))?[^:]*:mailto:(.+)$/i.exec(line);
      if (attendee) entries.push({ line: i + 1, name: attendee[1]?.replace(/"/g, '') ?? attendee[2]!, title: null, company: null, emails: [attendee[2]!.toLowerCase()], linkedin: null });
    });
  }
  return { rows, entries, dropped: [...dropped].map(([what, n]) => ({ what, count: n })) };
}
