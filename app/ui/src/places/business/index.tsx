/**
 * The business pages behind the rail's business menu, one per address, as a segmented nav in the D look (w3 3G1):
 *   #/business/plan    plan and playbook (Team's empty state links here)
 *   #/business/prices  prices with receipts (Today's "Set prices")
 *   #/business/build   website build
 *   #/business/practice  practice clients, the improvement loop and the judge setting (PracticeView)
 *   #/business/ca      your CA, for a business on the CA firm playbook (the page is listed only there)
 *   #/business/keep    keep this business: the recovery code and the optional passphrase (Today's "Keep it")
 * Any other address shows the plan. The pages follow the business menu's order. Switching business and starting a new
 * one live in the menu itself. The experimental storage note shows under the header on every page but Keep, which
 * says it in its own words (3A2). Goals (W4 4I) and Notifications (W4 4G) join the pages when the engine sends them.
 */

import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { useRoute } from '../../shell/navigation';
import { StorageNotice } from '../../shell/StorageNotice';
import { PageTitle } from '../../parts/PageTitle';
import { Segmented } from '../../parts/Segmented';
import { BuildView } from './BuildView';
import { KeepView } from './KeepView';
import { PlanView } from './PlanView';
import { PricesView } from './PricesView';
import { PracticeView } from './PracticeView';
import { YourCa } from './YourCa';
import s from './Business.module.css';

const PAGES = [
  { sub: 'plan', title: 'business.plan', View: PlanView },
  { sub: 'prices', title: 'business.prices', View: PricesView },
  { sub: 'build', title: 'business.build', View: BuildView },
  { sub: 'practice', title: 'business.practice', View: PracticeView },
  { sub: 'ca', title: 'business.ca', View: YourCa },
  { sub: 'keep', title: 'business.keep', View: KeepView },
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
  const listed = PAGES.filter((p) => p.sub !== 'ca' || caFirm);
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
