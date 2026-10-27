/**
 * Every playbook's desk on Work, by playbook id (Ink v2 wave 5, package 5-0). Never edited after 5-0: a package
 * replaces only its own <Id>Desk.tsx. Nothing renders these yet: the package that first shows a desk on Work wires
 * DESKS there (the plan names 5A1's kit or the first business package), and a stub says "Not built yet".
 */

import type { ComponentType } from 'react';
import type { DeskPlaybook } from '../../../engine/types';
import { YoutubeDesk } from './YoutubeDesk';
import { CaFirmDesk } from './CaFirmDesk';
import { SocialAgencyDesk } from './SocialAgencyDesk';
import { SeoVisibilityDesk } from './SeoVisibilityDesk';
import { OnlineSellerDesk } from './OnlineSellerDesk';
import { SupportDeskDesk } from './SupportDeskDesk';
import { RecruitingDeskDesk } from './RecruitingDeskDesk';
import { JobSearchDeskDesk } from './JobSearchDeskDesk';
import { TranslationStudioDesk } from './TranslationStudioDesk';
import { BookkeepingCfoDesk } from './BookkeepingCfoDesk';
import { PodcastToArticleDesk } from './PodcastToArticleDesk';
import { LeadGenerationDesk } from './LeadGenerationDesk';
import { NewsletterStudioDesk } from './NewsletterStudioDesk';
import { TenderDeskDesk } from './TenderDeskDesk';
import { WebsiteStudioDesk } from './WebsiteStudioDesk';
import { NarrationStudioDesk } from './NarrationStudioDesk';
import { VirtualAssistantDesk } from './VirtualAssistantDesk';
import { DataEntryDeskDesk } from './DataEntryDeskDesk';
import { AppTestingDesk } from './AppTestingDesk';
import { DevAgencyDesk } from './DevAgencyDesk';
import { MonitoredDataDesk } from './MonitoredDataDesk';
import { ItTriageDesk } from './ItTriageDesk';
import { PhoneReceptionistDesk } from './PhoneReceptionistDesk';

export const DESKS: Readonly<Record<DeskPlaybook, ComponentType>> = Object.freeze({
  'youtube': YoutubeDesk,
  'ca-firm': CaFirmDesk,
  'social-agency': SocialAgencyDesk,
  'seo-visibility': SeoVisibilityDesk,
  'online-seller': OnlineSellerDesk,
  'support-desk': SupportDeskDesk,
  'recruiting-desk': RecruitingDeskDesk,
  'job-search-desk': JobSearchDeskDesk,
  'translation-studio': TranslationStudioDesk,
  'bookkeeping-cfo': BookkeepingCfoDesk,
  'podcast-to-article': PodcastToArticleDesk,
  'lead-generation': LeadGenerationDesk,
  'newsletter-studio': NewsletterStudioDesk,
  'tender-desk': TenderDeskDesk,
  'website-studio': WebsiteStudioDesk,
  'narration-studio': NarrationStudioDesk,
  'virtual-assistant': VirtualAssistantDesk,
  'data-entry-desk': DataEntryDeskDesk,
  'app-testing': AppTestingDesk,
  'dev-agency': DevAgencyDesk,
  'monitored-data': MonitoredDataDesk,
  'it-triage': ItTriageDesk,
  'phone-receptionist': PhoneReceptionistDesk,
});
