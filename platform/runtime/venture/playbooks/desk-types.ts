// Chausar playbooks: the shapes of venture.desk.list, .get and .act (Ink v2 wave 5, package 5-0). Every business keeps
// its own records through these three methods, keyed by playbook and record kind; each package declares its kinds in
// its own desk.ts (a DeskKindTypes per kind) and this file joins them, one line per package. A payload names the
// playbook and the kind; the result is typed by the union of every package's kinds. Types only. Written for Chausar;
// nothing here is learned from an outside source.
import type { Context } from '../../contracts.ts';
import type { Display, Json, VentureDeps } from '../contracts.ts';
import type { YoutubeDeskTypes } from './youtube/desk.ts';
import type { CaFirmDeskTypes } from './ca-firm/desk.ts';
import type { SocialAgencyDeskTypes } from './social/desk.ts';
import type { SeoVisibilityDeskTypes } from './seo-visibility/desk.ts';
import type { OnlineSellerDeskTypes } from './online-seller/desk.ts';
import type { SupportDeskDeskTypes } from './support-desk/desk.ts';
import type { RecruitingDeskDeskTypes } from './recruiting-desk/desk.ts';
import type { JobSearchDeskDeskTypes } from './job-search-desk/desk.ts';
import type { TranslationStudioDeskTypes } from './translation-studio/desk.ts';
import type { BookkeepingCfoDeskTypes } from './bookkeeping-cfo/desk.ts';
import type { PodcastToArticleDeskTypes } from './podcast-to-article/desk.ts';
import type { LeadGenerationDeskTypes } from './lead-generation/desk.ts';
import type { NewsletterStudioDeskTypes } from './newsletter-studio/desk.ts';
import type { TenderDeskDeskTypes } from './tender-desk/desk.ts';
import type { WebsiteStudioDeskTypes } from './website-studio/desk.ts';
import type { NarrationStudioDeskTypes } from './narration-studio/desk.ts';
import type { VirtualAssistantDeskTypes } from './virtual-assistant/desk.ts';
import type { DataEntryDeskDeskTypes } from './data-entry-desk/desk.ts';
import type { AppTestingDeskTypes } from './app-testing/desk.ts';
import type { DevAgencyDeskTypes } from './dev-agency/desk.ts';
import type { MonitoredDataDeskTypes } from './monitored-data/desk.ts';
import type { ItTriageDeskTypes } from './it-triage/desk.ts';
import type { PhoneReceptionistDeskTypes } from './phone-receptionist/desk.ts';

/** One record kind on a desk: its list filter, a row, the whole item, and each action's payload and result. */
export type DeskKindTypes = {
  filter: Json;
  row: unknown;
  item: unknown;
  actions: Readonly<Record<string, { payload: Json; result: unknown }>>;
};

/** Every playbook's desk kinds, by playbook id (one line per package). */
export type DeskTypes = {
  'youtube': YoutubeDeskTypes; // 5B1, 5B2, 5B3
  'ca-firm': CaFirmDeskTypes; // 5C1, 5C2
  'social-agency': SocialAgencyDeskTypes; // 5D1, 5D2, 5D3
  'seo-visibility': SeoVisibilityDeskTypes; // 5E1, 5E2
  'online-seller': OnlineSellerDeskTypes; // 5F1, 5F2, 5F3
  'support-desk': SupportDeskDeskTypes; // 5G
  'recruiting-desk': RecruitingDeskDeskTypes; // 5H
  'job-search-desk': JobSearchDeskDeskTypes; // 5I
  'translation-studio': TranslationStudioDeskTypes; // 5J1, 5J2
  'bookkeeping-cfo': BookkeepingCfoDeskTypes; // 5K1, 5K2
  'podcast-to-article': PodcastToArticleDeskTypes; // 5L
  'lead-generation': LeadGenerationDeskTypes; // 5M
  'newsletter-studio': NewsletterStudioDeskTypes; // 5N
  'tender-desk': TenderDeskDeskTypes; // 5O
  'website-studio': WebsiteStudioDeskTypes; // 5P
  'narration-studio': NarrationStudioDeskTypes; // 5Q
  'virtual-assistant': VirtualAssistantDeskTypes; // 5R1
  'data-entry-desk': DataEntryDeskDeskTypes; // 5R2
  'app-testing': AppTestingDeskTypes; // 5R3
  'dev-agency': DevAgencyDeskTypes; // 5R4
  'monitored-data': MonitoredDataDeskTypes; // 5R5
  'it-triage': ItTriageDeskTypes; // 5R5
  'phone-receptionist': PhoneReceptionistDeskTypes; // 5R6
};

export type DeskPlaybook = keyof DeskTypes;
type KindsOf<P extends DeskPlaybook> = keyof DeskTypes[P] & string;
type EntryOf<P extends DeskPlaybook, K extends KindsOf<P>> = DeskTypes[P][K] extends DeskKindTypes ? DeskTypes[P][K] : never;
type Part = 'row' | 'item';
type PartOf<X extends Part> = { [P in DeskPlaybook]: { [K in KindsOf<P>]: EntryOf<P, K>[X] }[KindsOf<P>] }[DeskPlaybook];
type ActResultOf = { [P in DeskPlaybook]: { [K in KindsOf<P>]: EntryOf<P, K>['actions'][string]['result'] }[KindsOf<P>] }[DeskPlaybook];

/** `${playbook}.${kind}` for every kind any desk declares (never, until a package declares one). */
export type DeskKey = { [P in DeskPlaybook]: `${P}.${KindsOf<P>}` }[DeskPlaybook];
export type DeskRow = PartOf<'row'>;
export type DeskItem = PartOf<'item'>;
export type DeskActResult = ActResultOf;

export type DeskListPayload = { playbook: DeskPlaybook; kind: string; filter?: Json };
export type DeskGetPayload = { playbook: DeskPlaybook; kind: string; id: string };
/** digest: the item's digest as the owner saw it, for an action that must refuse a changed item. */
export type DeskActPayload = { playbook: DeskPlaybook; kind: string; id: string; action: string; payload: Json; digest?: string };
export type DeskListView = { playbook: DeskPlaybook; kind: string; rows: DeskRow[]; line: Display };
export type DeskItemView = { playbook: DeskPlaybook; kind: string; item: DeskItem; digest: string };
export type DeskActView = { playbook: DeskPlaybook; kind: string; id: string; result: DeskActResult; line: Display };

/**
 * What a package's desk.ts gives for one record kind. Each handler gets the request with playbook and kind already
 * matched, checks the rest itself (fields, level, app channel, digest) and answers in the engine's codes and words.
 */
export type DeskHandler = {
  list?(deps: VentureDeps, ctx: Context, payload: DeskListPayload): Promise<DeskListView>;
  get?(deps: VentureDeps, ctx: Context, payload: DeskGetPayload): Promise<DeskItemView>;
  act?(deps: VentureDeps, ctx: Context, payload: DeskActPayload): Promise<DeskActView>;
};
/** A desk's handlers, by record kind. */
export type DeskHandlers = Readonly<Record<string, DeskHandler>>;
