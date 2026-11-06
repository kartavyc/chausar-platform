/**
 * The business pages behind the rail's business menu, one per address:
 *   #/business/plan    plan and playbook (Team's empty state links here)
 *   #/business/prices  prices with receipts (Today's "Set prices")
 *   #/business/build   website build
 *   #/business/keep    keep this business: the recovery code and the optional passphrase (Today's "Keep it")
 *   #/business/ca      your CA, for a business on the CA firm playbook (the page is listed only there)
 *   #/business/practice  practice clients, the improvement loop and the judge setting (PracticeView)
 * Any other address shows the plan. Switching business and starting a new one live in the menu itself.
 */

import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { useRoute } from '../../shell/navigation';
import { PageTitle } from '../../parts/PageTitle';
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
  { sub: 'practice', title: 'business.practice', View: PracticeView },
  { sub: 'build', title: 'business.build', View: BuildView },
  { sub: 'keep', title: 'business.keep', View: KeepView },
  { sub: 'ca', title: 'business.ca', View: YourCa },
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
      <nav className={s.nav} aria-label={t('business.pages')}>
        {listed.map((p) => (
          <a key={p.sub} className={s.navLink} href={`#/business/${p.sub}`} aria-current={p === page ? 'page' : undefined}>{t(p.title)}</a>
        ))}
      </nav>
      <View key={page.sub} />
    </>
  );
}
