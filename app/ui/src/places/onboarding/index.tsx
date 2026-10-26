import { useContext, useId, useState } from 'react';
import { useT } from '../../text';
import { Gallery } from '../../parts/Gallery';
import { PageTitle } from '../../parts/PageTitle';
import { SectionHead } from '../../parts/Tile';
import { HowStarting } from './HowStarting';
import { ResumeSetup } from './ResumeSetup';
import { StartedContext } from './started';
import { Start } from './Start';
import { waysToShow, type WaysSlot } from './ways';
import s from './Onboarding.module.css';

/** "New business" from the business menu: Start, inside the app. */
export function Place() {
  const started = useContext(StartedContext);
  return <StartPage onStarted={started} />;
}

/**
 * Start (D-Start.dc.html): the header, "How starting works", the gallery of ways to earn when the engine sends any,
 * the one-sentence tile, and "Resume setup" for the open business. Wave 3 has no ways to earn (W4 4J21 maps
 * `venture.playbooks.list` into `gallery`), so the page asks the owner to describe the business; with ways it says
 * "Pick a way to earn" and the box becomes "Or describe it in one sentence". The fit tile and "Not sure which fits?"
 * wait for W4 4C2. Once the one-sentence start has begun, "Resume setup" goes: the business it names was just locked,
 * and a click would lose a recovery code shown once.
 */
export function StartPage({ gallery, onStarted }: { gallery?: WaysSlot | undefined; onStarted: () => void }) {
  const t = useT();
  const galleryId = useId();
  const [begun, setBegun] = useState(false);
  const ways = waysToShow(gallery);
  const count = ways ? String(ways.ways.length) : undefined;
  return (
    <div className={s.page}>
      <PageTitle
        eyebrow={t('onboarding.page.eyebrow')}
        title={t(ways ? 'onboarding.page.pick' : 'onboarding.page.describe')}
        line={count !== undefined ? t('onboarding.page.lineWays', { count }) : t('onboarding.page.line')}
        count={count}
      />
      <HowStarting picking={ways !== undefined} />
      {ways && (
        <section className={s.ways} aria-labelledby={galleryId}>
          <SectionHead id={galleryId} title={t('onboarding.gallery.title')} end={<span className={s.waysMeta}>{t('onboarding.gallery.meta')}</span>} />
          <Gallery ways={ways.ways} featured={ways.featured} onStart={ways.onStart} />
        </section>
      )}
      <Start variant="place" onStarted={onStarted} orDescribe={ways !== undefined} onBegin={setBegun} />
      {!begun && <ResumeSetup />}
    </div>
  );
}
