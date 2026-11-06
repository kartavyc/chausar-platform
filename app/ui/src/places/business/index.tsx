/**
 * Settings (C1 task 7): the business's settings pages, one per address, listed in four groups with a search
 * (shell/settings.ts, SettingsList.tsx). From 760 px the list sits on the left and the page on the right; on a phone
 * `#/business` is the list alone and `#/business/<sub>` the page alone with a way back to Settings. A wide window
 * opens How the work is done at `#/business`. The pages:
 *   #/business/plan    plan and playbook (Team's empty state links here)
 *   #/business/prices  prices with receipts (Today's "Set prices")
 *   #/business/goals   the monthly goal, money invoiced before tax (W4 4I2; Today's goal card opens it)
 *   #/business/go-no-go  a GO, HOLD or NO-GO card before something new, with the most it could lose (W5 5A2)
 *   #/business/build   website build
 *   #/business/practice  practice clients, the improvement loop and the judge setting (PracticeView); W4 4J22a adds
 *                      drills, what the loop tried and the guidance report
 *   #/business/routines  routines on a schedule with a time zone and their history (W4 4J22a)
 *   #/business/ca      your CA, for a business on the CA firm playbook (the page is listed only there)
 *   #/business/notifications  the bell's settings: pause, quiet hours, the digest, phone alerts or the tray (W4 4G4)
 *   #/business/keep    keep this business: the recovery code and the optional passphrase (Today's "Keep it")
 *   #/business/away    the days the owner is away, what falls due, a reply to paste (W4 4F3; the menu's Away)
 *   #/business/decisions  who decided each thing, when, on what rule, with Stop always allowing (W4 4J19)
 *   #/business/owner   about you: the owner's first name and the services the business does not sell (W4 4J21)
 *   #/business/voice   the business's voice: six sections per language and channel, versions, learn from writing (W4 4J22b)
 *   #/business/knowledge  what the AI knows: sources, the test search, files the agents need (W4 4J22b)
 *   #/business/app     this app on this computer: Animations follow the computer or are off (one-shot C3)
 * Any other address shows the plan (beside the list) or the list (a phone). Switching business and starting a new one
 * live in the business menu. The experimental storage note shows under the header on every page but Keep, which says
 * it in its own words (3A2).
 */

import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { useRoute } from '../../shell/navigation';
import { SETTINGS_HREF, settingsFor } from '../../shell/settings';
import { useNarrow } from '../../shell/useNarrow';
import { StorageNotice } from '../../shell/StorageNotice';
import { PageTitle } from '../../parts/PageTitle';
import { AwayView } from './AwayView';
import { BuildView } from './BuildView';
// W4 4J19: who decided what, on what rule (catalogue O17).
import { DecisionsView } from './DecisionsView';
import { GoalsView } from './GoalsView';
import { GoNoGoCard } from './GoNoGoCard';
import { KeepView } from './KeepView';
// W4 4J22b: the business's voice, and what the AI knows.
import { KnowledgeView } from './KnowledgeView';
import { NotificationsView } from './NotificationsView';
import { OwnerView } from './OwnerView';
import { PlanView } from './PlanView';
import { PricesView } from './PricesView';
import { PracticeView } from './PracticeView';
import { VoiceView } from './VoiceView';
import { RoutinesView } from './RoutinesView';
import { YourCa } from './YourCa';
// W6 6C5: the locked rules the owner can tick, and the hard stops.
import { YourRules } from './YourRules';
// W6 6G1: the chats archive (D42: it lives in Settings).
import { SettledChats } from '../chats/SettledChats';
// W6 6J2: reports, the opt-in Send report with its preview and Delete my reports.
import { ReportsView } from './ReportsView';
import { SettingsList } from './SettingsList';
// One-shot C3: This app, the Animations switch.
import { ThisAppView } from './ThisAppView';
import { UpdatesView } from './UpdatesView';
import s from './Business.module.css';

const PAGES = [
  { sub: 'plan', title: 'business.plan', View: PlanView },
  { sub: 'prices', title: 'business.prices', View: PricesView },
  { sub: 'goals', title: 'business.goals', View: GoalsView },
  // W5 5A2: a GO, HOLD or NO-GO card before something new, with the most it could lose (catalogue M18).
  { sub: 'go-no-go', title: 'kit-sales.page', View: GoNoGoCard },
  { sub: 'build', title: 'business.build', View: BuildView },
  { sub: 'practice', title: 'business.practice', View: PracticeView },
  // W4 4J22a: questions on a schedule with a time zone, each run waiting on Today, and their history.
  { sub: 'routines', title: 'business.routines', View: RoutinesView },
  { sub: 'ca', title: 'business.ca', View: YourCa },
  { sub: 'notifications', title: 'business.notify', View: NotificationsView },
  { sub: 'keep', title: 'business.keep', View: KeepView },
  // W4 4F3: the days the owner is away, what falls due and a reply to paste (the business menu's Away).
  { sub: 'away', title: 'business.away', View: AwayView },
  // W4 4J19: who decided each thing, on what rule, with Stop always allowing.
  { sub: 'decisions', title: 'business.decisions', View: DecisionsView },
  // W4 4J21: the owner's first name (Today's greeting) and the services the business does not sell.
  { sub: 'owner', title: 'business.owner', View: OwnerView },
  // W4 4J22b: how the business talks in every draft, and the sources agents read.
  { sub: 'voice', title: 'business.voice', View: VoiceView },
  { sub: 'knowledge', title: 'business.knowledge', View: KnowledgeView },
  // W6 6C5: the locked rules the owner can tick (one screen each) and the hard stops; listed only while it is the page.
  { sub: 'rules', title: 'business.yourRules', View: YourRules },
  // W6 6G1 (D42): settled chats and the quiet days before one settles; from the business menu and the Chats list,
  // listed only while it is the page.
  { sub: 'chats', title: 'business.chats', View: SettledChats },
  // W6 6J2 (D47): reports, off by default, from the business menu; listed only while it is the page.
  { sub: 'reports', title: 'feedback.page', View: ReportsView },
  // One-shot C3: how the app itself behaves on this computer (Animations), from the business menu; listed only while it
  // is the page. C1's Settings puts it last in Business.
  { sub: 'app', title: 'business.app', View: ThisAppView },
  // C5 task 33: the version, Check daily and what an update is doing, from the business menu; listed only while it is the page.
  { sub: 'updates', title: 'updates.page', View: UpdatesView },
] as const;

export function Place() {
  const t = useT();
  const route = useRoute();
  const narrow = useNarrow();
  const venture = useResource('venture.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const groups = settingsFor(venture.data);
  const asked = PAGES.find((p) => p.sub === route.sub);
  // A phone: Settings with no page named is the list alone.
  if (narrow && !asked) {
    return (
      <>
        <PageTitle title={t('place.business')} line={venture.data?.venture.workingName} />
        <SettingsList groups={groups} current={null} />
      </>
    );
  }
  const page = asked ?? PAGES[0];
  const { View } = page;
  return (
    <div className={s.settings} data-settings="">
      {!narrow && <div className={s.settingsList}><SettingsList groups={groups} current={page.sub} /></div>}
      <div className={s.settingsPage}>
        {narrow && <a className={s.settingsBack} href={SETTINGS_HREF} data-settings-back="">{t('business.settings.back')}</a>}
        <PageTitle title={t(page.title)} line={venture.data?.venture.workingName} />
        {page.sub !== 'keep' && <StorageNotice />}
        <View key={page.sub} />
      </div>
    </div>
  );
}
