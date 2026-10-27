/**
 * The fake engine's playbook desks (Ink v2 wave 5, package 5-0): one fake per playbook, each in its own file, joined
 * here. Never edited after 5-0: a package fills only its own fake-<id>.ts. venture.desk.list, .get and .act find the
 * playbook's desk and the record kind's handler; with none, they answer NOT_BUILT_YET as the engine does. A handler
 * gets the whole request and checks the rest itself (fields, app channel, digest), in the engine's codes and words. A
 * desk may also answer methods of its own (the CA firm's venture.ca.* of 5C1 and 5C2).
 */

import { EngineError } from './types';
import type { W4DeskHost } from './fake-w4';
import { fakeYoutubeDesk } from './fake-youtube';
import { fakeCaFirmDesk } from './fake-ca-firm';
import { fakeSocialAgencyDesk } from './fake-social';
import { fakeSeoVisibilityDesk } from './fake-seo-visibility';
import { fakeOnlineSellerDesk } from './fake-online-seller';
import { fakeSupportDeskDesk } from './fake-support-desk';
import { fakeRecruitingDeskDesk } from './fake-recruiting-desk';
import { fakeJobSearchDeskDesk } from './fake-job-search-desk';
import { fakeTranslationStudioDesk } from './fake-translation-studio';
import { fakeBookkeepingCfoDesk } from './fake-bookkeeping-cfo';
import { fakePodcastToArticleDesk } from './fake-podcast-to-article';
import { fakeLeadGenerationDesk } from './fake-lead-generation';
import { fakeNewsletterStudioDesk } from './fake-newsletter-studio';
import { fakeTenderDeskDesk } from './fake-tender-desk';
import { fakeWebsiteStudioDesk } from './fake-website-studio';
import { fakeNarrationStudioDesk } from './fake-narration-studio';
import { fakeVirtualAssistantDesk } from './fake-virtual-assistant';
import { fakeDataEntryDeskDesk } from './fake-data-entry-desk';
import { fakeAppTestingDesk } from './fake-app-testing';
import { fakeDevAgencyDesk } from './fake-dev-agency';
import { fakeMonitoredDataDesk } from './fake-monitored-data';
import { fakeItTriageDesk } from './fake-it-triage';
import { fakePhoneReceptionistDesk } from './fake-phone-receptionist';

/** One record kind's fake handlers, each given the whole request. */
export interface FakeDeskKind {
  list?(p: Record<string, unknown>): unknown;
  get?(p: Record<string, unknown>): unknown;
  act?(p: Record<string, unknown>): unknown;
}
/** One playbook's fake desk: its record kinds, and any methods of its own. */
export interface FakePlaybookDesk {
  readonly playbook: string;
  readonly kinds: Readonly<Record<string, FakeDeskKind>>;
  readonly methods?: Readonly<Record<string, (p: Record<string, unknown>) => unknown>>;
}

const MAKERS: readonly ((host: W4DeskHost) => FakePlaybookDesk)[] = [
  fakeYoutubeDesk,
  fakeCaFirmDesk,
  fakeSocialAgencyDesk,
  fakeSeoVisibilityDesk,
  fakeOnlineSellerDesk,
  fakeSupportDeskDesk,
  fakeRecruitingDeskDesk,
  fakeJobSearchDeskDesk,
  fakeTranslationStudioDesk,
  fakeBookkeepingCfoDesk,
  fakePodcastToArticleDesk,
  fakeLeadGenerationDesk,
  fakeNewsletterStudioDesk,
  fakeTenderDeskDesk,
  fakeWebsiteStudioDesk,
  fakeNarrationStudioDesk,
  fakeVirtualAssistantDesk,
  fakeDataEntryDeskDesk,
  fakeAppTestingDesk,
  fakeDevAgencyDesk,
  fakeMonitoredDataDesk,
  fakeItTriageDesk,
  fakePhoneReceptionistDesk,
];
const DESK_METHODS = new Set<string>(['venture.desk.list', 'venture.desk.get', 'venture.desk.act']);
const NOT_BUILT = 'This part of Chausar is not built yet.';

export class FakePlaybooksDesk {
  private readonly desks: readonly FakePlaybookDesk[];

  constructor(host: W4DeskHost) {
    this.desks = MAKERS.map((make) => make(host));
  }

  handles(method: string): boolean {
    return DESK_METHODS.has(method) || this.desks.some((desk) => desk.methods !== undefined && Object.hasOwn(desk.methods, method));
  }

  request(method: string, p: Record<string, unknown>): unknown {
    if (DESK_METHODS.has(method)) {
      const desk = this.desks.find((d) => d.playbook === p.playbook);
      const kind = desk && typeof p.kind === 'string' && Object.hasOwn(desk.kinds, p.kind) ? desk.kinds[p.kind] : undefined;
      const op = method.slice('venture.desk.'.length) as keyof FakeDeskKind;
      const handler = kind?.[op];
      if (!kind || !handler) throw new EngineError('NOT_BUILT_YET', NOT_BUILT);
      return handler.call(kind, p);
    }
    for (const desk of this.desks) if (desk.methods && Object.hasOwn(desk.methods, method)) return desk.methods[method]!(p);
    throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
  }
}
