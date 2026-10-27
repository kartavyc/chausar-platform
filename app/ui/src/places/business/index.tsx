/**
 * The business pages behind the rail's business menu, one per address, as a segmented nav in the D look (w3 3G1):
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
 * Any other address shows the plan. The pages follow the business menu's order. Switching business and starting a new
 * one live in the menu itself. The experimental storage note shows under the header on every page but Keep, which
 * says it in its own words (3A2).
 */

import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { useRoute } from '../../shell/navigation';
import { StorageNotice } from '../../shell/StorageNotice';
import { PageTitle } from '../../parts/PageTitle';
import { Segmented } from '../../parts/Segmented';
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
] as const;

/** The flagship playbook whose businesses have a CA of record. */
const CA_FIRM = 'ca-firm';

export function Place() {
  const t = useT();
  const route = useRoute();
  const venture = useResource('venture.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const page = PAGES.find((p) => p.sub === route.sub) ?? PAGES[0];
  const { View } = page;
  const caFirm = venture.data?.playbook?.id === CA_FIRM;
  // W5 5A2: Go or no go opens from the business menu, and joins the pages only while it is the page (simple first).
  const listed = PAGES.filter((p) => (p.sub !== 'ca' || caFirm) && (p.sub !== 'go-no-go' || page.sub === 'go-no-go'));
  return (
    <>
      <PageTitle title={t(page.title)} line={venture.data?.venture.workingName} />
      {page.sub !== 'keep' && <StorageNotice />}
      <Segmented
        // Your CA joins the pages once the engine names the playbook: a new row, so it brings the current page into view.
        key={listed.length}
        mode="links"
        className={s.nav}
        label={t('business.pages')}
        value={page.sub}
        options={listed.map((p) => ({ id: p.sub, label: t(p.title), href: `#/business/${p.sub}` }))}
      />
      <View key={page.sub} />
    </>
  );
}
