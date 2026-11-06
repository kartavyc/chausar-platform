import { useContext, useId, useMemo, useState } from 'react';
import { useLanguage, useT } from '../../text';
import { useResource } from '../../engine/context';
import { Gallery } from '../../parts/Gallery';
import { PageTitle } from '../../parts/PageTitle';
import { SectionHead } from '../../parts/Tile';
import { Beside, FitTile, NotSure, useFit } from './AskChausar';
import { GalleryFilters } from './GalleryFilters';
import { HowStarting } from './HowStarting';
import { ResumeSetup } from './ResumeSetup';
import { StartedContext } from './started';
import { Start } from './Start';
import { filterWays, orderWays, waysSlotOf, waysToShow, type WaySort, type WaysSlot } from './ways';
import s from './Onboarding.module.css';

const never = () => false;

/**
 * "New business" from the business menu: Start, inside the app. W4 4J21: the gallery is the engine's ways to earn
 * (venture.playbooks.list), the good fit (venture.chief.fit) is its featured tile, and the open business is the one the
 * sentence can be added to.
 */
export function Place() {
  const started = useContext(StartedContext);
  const language = useLanguage();
  const ways = useResource('venture.playbooks.list', {}, { refreshOn: never });
  const venture = useResource('venture.get', {}, { refreshOn: never });
  // W4 4C2 review: the fit is a call to the owner's AI, so it is asked only on the owner's press; StartPage features it then.
  const gallery = useMemo(() => (ways.data ? waysSlotOf(ways.data, language, null) : undefined), [ways.data, language]);
  // 4Z2: a new business starts in the open one's country (the engine's code), not the browser's region alone.
  return <StartPage gallery={gallery} onStarted={started} business={venture.data?.venture.workingName} country={venture.data?.venture.country?.code ?? undefined} />;
}

/**
 * Start (D-Start.dc.html): the header, "How starting works", the gallery of ways to earn when the engine sends any,
 * the one-sentence tile, and "Resume setup" for the open business. Wave 3 has no ways to earn (W4 4J21 maps
 * `venture.playbooks.list` into `gallery`), so the page asks the owner to describe the business; with ways it says
 * "Pick a way to earn" and the box becomes "Or describe it in one sentence". W4 4C2: "Not sure which fits? Ask Chausar"
 * beside the box; its "Which way fits me?" asks venture.chief.fit, and the fit then shows beside How starting works and
 * is the gallery's featured tile. Once the one-sentence start has begun, "Resume setup" goes: the business it names was just locked,
 * and a click would lose a recovery code shown once.
 */
export function StartPage({ gallery, onStarted, business, country }: {
  gallery?: (Omit<WaysSlot, 'onStart'> & { onStart?: WaysSlot['onStart'] }) | undefined; onStarted: () => void;
  /** W4 4J21: the open business, which the sentence can be added to. */
  business?: string | undefined;
  /** 4Z2: the open business's country code, the first choice for a new one. */
  country?: string | undefined;
}) {
  const t = useT();
  const language = useLanguage();
  const galleryId = useId();
  const [chip, setChip] = useState('all');
  const [sort, setSort] = useState<WaySort>('best-fit');
  const [begun, setBegun] = useState(false);
  const { ask: fit, askFit } = useFit();
  const [fill, setFill] = useState<{ text: string; n: number } | undefined>();
  const featured = fit.state === 'shown' ? fit.fit.wayId : gallery?.featured;
  const ways = waysToShow(gallery ? { ...gallery, featured, onStart: gallery.onStart ?? (() => {}) } : undefined);
  const count = ways ? String(ways.ways.length) : undefined;
  const shown = ways ? orderWays(filterWays(ways.ways, chip, ways.upTo), sort, ways.featured, language) : [];
  /** A tile's Start puts its way's own sentence in the box below (never sent), as the fit's Start does (4J21). */
  const startWay = (id: string) => {
    const way = ways?.ways.find((item) => item.id === id);
    if (way?.starter) setFill((was) => ({ text: way.starter!, n: (was?.n ?? 0) + 1 }));
    ways?.onStart(id);
  };
  return (
    <div className={s.page}>
      <PageTitle
        eyebrow={t('onboarding.page.eyebrow')}
        title={t(ways ? 'onboarding.page.pick' : 'onboarding.page.describe')}
        line={count !== undefined ? t('onboarding.page.lineWays', { count }) : t('onboarding.page.line')}
        count={count}
      />
      <Beside aside={fit.state === 'shown' ? <FitTile fit={fit.fit} way={fit.way} onStart={(text) => setFill((was) => ({ text, n: (was?.n ?? 0) + 1 }))} /> : null}>
        <HowStarting picking={ways !== undefined} />
      </Beside>
      {ways && (
        <section className={s.ways} aria-labelledby={galleryId}>
          <SectionHead id={galleryId} title={t('onboarding.gallery.title')} end={<span className={s.waysMeta}>{t(ways.ways.some((way) => way.hoursEstimate) ? 'onboarding.ways.meta' : 'onboarding.gallery.meta')}</span>} />
          {ways.categories && (
            <GalleryFilters total={ways.ways.length} categories={ways.categories} upTo={ways.upTo} chip={chip} onChip={setChip} sort={sort} onSort={setSort} />
          )}
          {shown.length > 0
            ? <Gallery ways={shown} featured={ways.featured} onStart={startWay} />
            : <p className={s.waysNone} role="status">{t('onboarding.ways.none')}</p>}
        </section>
      )}
      <Beside aside={<NotSure fit={fit} onFit={() => void askFit()} />}>
        <Start variant="place" onStarted={onStarted} orDescribe={ways !== undefined} onBegin={setBegun} fill={fill} business={business} home={country} />
      </Beside>
      {!begun && <ResumeSetup />}
    </div>
  );
}
