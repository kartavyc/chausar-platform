import { Fragment } from 'react';
import { useLanguage, useT } from '../text';
import { Avatar } from './Avatar';
import { cx } from './cx';
import { rich } from './rich';
import s from './PathLine.module.css';

/** How strong one known link is, worked out in code from the owner's own records (W4 4D). */
export type LinkStrength = 'strong' | 'fair';

export interface PathPerson {
  /** The person this step reaches: a connector, then the person at the end. */
  name: string;
  /** Whether Chausar can confirm this step from a stored fact. A step it cannot confirm is dashed and said in words. */
  confirmed: boolean;
  /** The strength of this step, when it is confirmed and code has one. Left out, the step is drawn neutral. */
  strength?: LinkStrength | undefined;
}

export interface PathLineProps {
  /** The people after the owner, in order. One person means the owner knows them directly. */
  people: readonly PathPerson[];
  /** The owner's name, for the first avatar's initials (W4 4J's owner profile). Left out, the avatar says "You". */
  owner?: string | undefined;
  /** `card`: small avatars and a caption under the line (a pipeline card). `named`: each name under its avatar and
   *  the caption beside the line (a network result, D's `.r-path`). */
  layout?: 'card' | 'named' | undefined;
  /** The strength of the whole path, as code works it out (W4 4D), for the caption ("via Meera Joshi, strong").
   *  It is never borrowed from one step; left out, the caption names the connector only. */
  strength?: LinkStrength | undefined;
  className?: string | undefined;
}

const ORDINALS = 5;

/**
 * A warm path (spec 5.5): you, then whoever connects you, then the person, as avatars joined by lines. A strong step
 * is a solid ink line, a fair one a thinner grey line, one code has no strength for a plain light line (it claims
 * neither), and a step Chausar cannot confirm is dashed and labelled
 * "possible path, not confirmed" in words (spec 8). The whole line is one image whose name reads the path aloud.
 */
export function PathLine({ people, owner, layout = 'card', strength, className }: PathLineProps) {
  const t = useT();
  const language = useLanguage();
  const named = layout === 'named';
  const size = named ? 28 : 24;
  const last = people[people.length - 1];
  const unconfirmed = people.flatMap((person, index) => (person.confirmed ? [] : [index + 1]));
  const possible = unconfirmed.length > 0;

  let label: string;
  if (people.length <= 1) {
    label = t(possible ? 'path.directPossible' : 'path.direct', { name: last?.name ?? '' });
  } else {
    const chain = [t('path.you'), ...people.map((person) => person.name)].join(t('path.then'));
    if (!possible) {
      label = `${t('path.label', { chain })} ${people.length === 2 ? t('path.bothConfirmed') : t('path.allConfirmed', { count: people.length })}`;
    } else {
      const words = unconfirmed.map((step) => (step <= ORDINALS ? t(`path.ordinal.${step}`) : t('path.ordinal.n', { n: step })));
      const which = new Intl.ListFormat(language === 'hi' ? 'hi-IN' : 'en-IN', { type: 'conjunction' }).format(words);
      label = `${t('path.labelPossible', { chain })} ${t('path.unconfirmed', { count: unconfirmed.length, which })}`;
    }
  }

  const connector = people.length > 1 ? people[0]! : null;
  const name = connector ? <b className={s.name}>{connector.name}</b> : null;
  let caption;
  if (connector && !possible && strength) {
    caption = rich(t, 'path.viaStrength', { strength: t(`path.strength.${strength}`) }, { name });
  } else if (connector) {
    caption = rich(t, 'path.via', {}, { name });
  } else if (!possible && last) {
    caption = t('path.knowDirectly', { name: last.name });
  }

  return (
    <div className={cx(s.path, className)} data-layout={layout}>
      <div className={s.line} role="img" aria-label={label}>
        <span className={s.node} data-path-node="you">
          <Avatar name={owner ?? t('path.youName')} size={size} />
          {named && <span className={s.nodeName}>{t('path.youName')}</span>}
        </span>
        {people.map((person, index) => (
          <Fragment key={index}>
            <span className={s.link} data-confirmed={String(person.confirmed)} data-strength={person.confirmed ? person.strength : undefined} />
            <span className={s.node} data-path-node="">
              <Avatar name={person.name} size={size} />
              {named && <span className={s.nodeName}>{person.name}</span>}
            </span>
          </Fragment>
        ))}
      </div>
      {(caption || possible) && (
        <p className={s.caption}>
          {caption}
          {caption && possible && ' '}
          {possible && <span className={s.unconfirmed}>{t('path.notConfirmed')}</span>}
        </p>
      )}
    </div>
  );
}
