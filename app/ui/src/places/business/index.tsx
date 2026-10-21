/**
 * The business pages behind the rail's business menu, one per address:
 *   #/business/plan    plan and playbook (Team's empty state links here)
 *   #/business/prices  prices with receipts (Today's "Set prices")
 *   #/business/build   website build
 *   #/business/keep    keep this business: the recovery code and the optional passphrase (Today's "Keep it")
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
import s from './Business.module.css';

const PAGES = [
  { sub: 'plan', title: 'business.plan', View: PlanView },
  { sub: 'prices', title: 'business.prices', View: PricesView },
  { sub: 'build', title: 'business.build', View: BuildView },
  { sub: 'keep', title: 'business.keep', View: KeepView },
] as const;

export function Place() {
  const t = useT();
  const route = useRoute();
  const venture = useResource('venture.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const page = PAGES.find((p) => p.sub === route.sub) ?? PAGES[0];
  const { View } = page;
  return (
    <>
      <PageTitle title={t(page.title)} line={venture.data?.venture.workingName} />
      <nav className={s.nav} aria-label={t('business.pages')}>
        {PAGES.map((p) => (
          <a key={p.sub} className={s.navLink} href={`#/business/${p.sub}`} aria-current={p === page ? 'page' : undefined}>{t(p.title)}</a>
        ))}
      </nav>
      <View key={page.sub} />
    </>
  );
}
