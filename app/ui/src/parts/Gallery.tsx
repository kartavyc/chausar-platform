import { useId } from 'react';
import { useLanguage, useT } from '../text';
import { Avatar, initialsOf, type DeptId } from './Avatar';
import { Button, type ButtonSize } from './Button';
import { cx } from './cx';
import { Count } from './Figure';
import { Icon } from './Icon';
import { ModelEstimate } from './ModelEstimate';
import type { IconName } from './icons';
import s from './Gallery.module.css';

/**
 * One way to earn, as the gallery shows it. Every string is the engine's (W4 4J, `venture.playbooks.list`; one per
 * playbook in W5); the UI computes none of it.
 */
export interface GalleryWay {
  id: string;
  name: string;
  /** What the business is, in one or two lines. */
  line: string;
  icon: IconName;
  /** The department tint for the icon box, when the engine says one (W4 4A). */
  dept?: DeptId | undefined;
  /** The category chip ("Marketing"). Not shown when the owner already runs one. */
  category?: string | undefined;
  /** The business of this kind the owner already runs: the tile says "You run this" with its initials. */
  running?: string | undefined;
  /** The hours a week the owner puts in ("4 to 8 h a week"). */
  hours: string;
  /** W4 4J21: the hours are a model's estimate too (4J8's hoursEstimate), so a screen reader hears it with them. */
  hoursEstimate?: boolean | undefined;
  /** What the owner does. */
  youDo: string;
  /** The agents that run it, and what they do. */
  team: { names: readonly string[]; line: string };
  /** What clients usually pay: a range a model wrote, so it always reads "model estimate" and never has a receipt.
   *  `per` says per what ("per mention"). */
  pay: { range: string; per?: string | undefined; source?: string | undefined };
  /** W4 4J21: what the owner needs besides time (their own AI, the connections it uses), one fold away with the pay
   *  range's source. */
  needs?: readonly string[] | undefined;
}

export interface GalleryTileProps {
  way: GalleryWay;
  /** The one tile whose Start is the filled primary (the good fit, W4 4C). Every other Start is a secondary. */
  featured?: boolean | undefined;
  onStart: (id: string) => void;
  /** The Start button's size. Left out: md, which grows to the 44 px touch target on a phone (under 760 px). */
  buttonSize?: ButtonSize | undefined;
  className?: string | undefined;
}

/** At most this many avatars in a tile's stack; the stack's name still lists every agent. */
const STACK = 5;

/**
 * One way to earn as a tile (D-Start's `.way`): its icon, a category chip (or "You run this"), the name and line,
 * then two facts at rest: the hours, and what clients usually pay as a model estimate. What you do, what your AI team
 * does (with an avatar stack), what the way needs and the pay range's source are one fold away. One Start button, a secondary unless the tile is featured. "Good fit for you" is a model's
 * judgement, so it carries the "model estimate" label too.
 */
export function GalleryTile({ way, featured = false, onStart, buttonSize, className }: GalleryTileProps) {
  const t = useT();
  const language = useLanguage();
  const titleId = useId();
  const agents = new Intl.ListFormat(language === 'hi' ? 'hi-IN' : 'en-IN', { style: 'long', type: 'conjunction' }).format(way.team.names);
  const startName = way.running ? t('gallery.startAnotherNamed', { name: way.name }) : t('gallery.startNamed', { name: way.name });
  return (
    <article className={cx(s.tile, className)} aria-labelledby={titleId} data-card="" data-featured={featured ? '' : undefined}>
      <div className={s.head}>
        <span className={s.icon} data-dept={way.dept ?? 'none'}><Icon name={way.icon} size={20} /></span>
        {featured ? (
          <span className={s.fit} data-fit="">
            <span className={s.chip} data-chip="" data-tone="fit"><Icon name="sparkles" size={14} />{t('gallery.featured')}</span>
            <ModelEstimate />
          </span>
        ) : way.running ? (
          <span className={s.chip} data-chip=""><span className={s.square} aria-hidden="true">{initialsOf(way.running)}</span>{t('gallery.youRunThis')}</span>
        ) : way.category ? (
          <span className={s.chip} data-chip="">{way.category}</span>
        ) : null}
      </div>
      <h3 id={titleId} className={s.name}>{way.name}</h3>
      <p className={s.line}>{way.line}</p>
      {/* W4 4J21 (integrator): at rest a tile is its name, one line, the hours and the pay; what you do, what the AI team
          does, what it needs and where the pay range came from are one fold away. */}
      <ul className={s.facts}>
        <li className={s.fact}>
          <p className={s.factHead}>
            <Icon name="clock" size={14} />
            <span className={s.factName}>{t('gallery.yourTime')}</span>
            <span className={s.hours}>{way.hours}</span>
            {way.hoursEstimate && <span className="sr-only">, {t('gallery.estimateHours')}</span>}
          </p>
        </li>
        {/* The range is a model's, proved by its "model estimate" label on the line above, as on the board: the fact is
            one figure group. */}
        <li className={s.fact} data-figure-group="">
          <p className={s.factHead}>
            <Icon name="indian-rupee" size={14} />
            <span className={s.factName}>{way.pay.per ? t('gallery.payPer', { per: way.pay.per }) : t('gallery.pay')}</span>
            <ModelEstimate />
          </p>
          <p className={cx(s.pay, 'mono')}>{way.pay.range}</p>
        </li>
      </ul>
      <details className={s.needs} data-way-needs="">
        <summary className={s.needsHead}>{t('gallery.needs')}</summary>
        <p className={s.factHead}><Icon name="clock" size={14} /><span className={s.factName}>{t('gallery.youDo')}</span></p>
        <p className={s.factLine}>{way.youDo}</p>
        <p className={s.factHead}>
          <Icon name="bot" size={14} />
          <span className={s.factName}>{t('gallery.teamDoes')}</span>
          {way.team.names.length > 0 && (
            <span className={s.stack} role="img" aria-label={t('gallery.team', { count: way.team.names.length, names: agents })}>
              {way.team.names.slice(0, STACK).map((name, index) => <Avatar key={index} name={name} size={24} />)}
              {way.team.names.length > STACK && <Count value={`+${way.team.names.length - STACK}`} className={s.more} />}
            </span>
          )}
        </p>
        <p className={s.factLine}>{way.team.line}</p>
        {way.needs?.map((line) => <p key={line} className={s.factLine}>{line}</p>)}
        {way.pay.source && <p className={s.source}>{way.pay.source}</p>}
      </details>
      <div className={s.foot}>
        <Button
          variant={featured ? 'primary' : 'secondary'}
          size={buttonSize}
          className={s.start}
          aria-label={startName}
          onClick={() => onStart(way.id)}
        >
          {/* 4Z2: every tile reads Start; "You run this" says why one starts another, and its name says so aloud. */}
          {t('gallery.start')}
          <Icon name="arrow-right" size={16} />
        </Button>
      </div>
    </article>
  );
}

export interface GalleryProps {
  ways: readonly GalleryWay[];
  /** The id of the one featured way, whose Start is the filled primary. */
  featured?: string | undefined;
  onStart: (id: string) => void;
  /** Every tile's Start size (see GalleryTile). */
  buttonSize?: ButtonSize | undefined;
  /** The list's name; "Ways to earn" when left out. */
  label?: string | undefined;
  className?: string | undefined;
}

/** The Start gallery (D-Start's `.gal`): the ways to earn as tiles in three columns, one on a phone. */
export function Gallery({ ways, featured, onStart, buttonSize, label, className }: GalleryProps) {
  const t = useT();
  return (
    <ul className={cx(s.gallery, className)} aria-label={label ?? t('gallery.label')}>
      {ways.map((way) => (
        <li key={way.id} className={s.item}>
          <GalleryTile way={way} featured={way.id === featured} onStart={onStart} buttonSize={buttonSize} />
        </li>
      ))}
    </ul>
  );
}
