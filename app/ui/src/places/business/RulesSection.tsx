import { useId } from 'react';
import { useLanguage, useT } from '../../text';
import { useResource } from '../../engine/context';
import type { PlatformRuleView } from '../../engine/types';
import { onDesktop, safeUrl } from '../connections/external';
import { dayOf } from './shared';
import s from './Business.module.css';
import r from './RulesSection.module.css';

/** The risk levels a playbook registration may carry (playbooks/registry.ts). */
const RISKS = ['low', 'medium', 'high'];

/**
 * Platform rules (venture.rules.list, Ink v2 wave 2 package 2H), on Plan and playbook: the dated rules the business's
 * playbook checks rest on. The engine's summary ("18 current, 2 to recheck."), the playbook's risk level and last
 * review, each rule past its recheck window with the engine's line and its source page, then the current rules with
 * what each does not cover. Every line is the engine's; nothing is counted or dated here. A business on no flagship
 * playbook shows nothing. On the desktop the source address is shown as text, because the desktop opens only its
 * listed partner sites.
 */
export function RulesSection() {
  const t = useT();
  const language = useLanguage();
  const headingId = useId();
  const staleId = useId();
  const currentId = useId();
  const rules = useResource('venture.rules.list', {}, { refreshOn: (event) => event.type === 'queue.changed' });

  if (rules.data === undefined && !rules.error) return null;
  if (rules.data && !rules.data.playbook) return null;
  const view = rules.data;
  const stale = view?.rules.filter((rule) => rule.stale) ?? [];
  const current = view?.rules.filter((rule) => !rule.stale) ?? [];
  return (
    <section className={s.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={s.heading}>{t('business.rules.heading')}</h2>
      {rules.error || !view?.playbook ? (
        <p className={s.problem} role="alert">{t('business.failed', { message: rules.error?.message ?? '' })}</p>
      ) : (
        <>
          <p className={s.line}>{view.summary}</p>
          <p className={s.note}>
            {t('business.rules.review', {
              risk: RISKS.includes(view.playbook.riskLevel) ? t(`business.rules.risk.${view.playbook.riskLevel}`) : view.playbook.riskLevel,
              day: dayOf(view.playbook.lastReviewed, language),
            })}
          </p>
          {stale.length > 0 && (
            <>
              <h3 id={staleId} className={s.heading}>{t('business.rules.recheck')}</h3>
              <ul className={s.steps} aria-labelledby={staleId}>
                {stale.map((rule) => (
                  <li key={rule.id} className={s.step} data-rule={rule.id}>
                    {rule.line}
                    <Source rule={rule} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {current.length > 0 && (
            <details className={s.fold}>
              <summary id={currentId}>{t('business.rules.current')}</summary>
              <ul className={s.steps} aria-labelledby={currentId}>
                {current.map((rule) => (
                  <li key={rule.id} className={s.step} data-rule={rule.id}>
                    {rule.rule}
                    <span className={s.stepWho}>{rule.line}</span>
                    {rule.limitations.length > 0 && (
                      <ul className={r.limits} aria-label={t('business.rules.limits')}>
                        {rule.limitations.map((line) => <li key={line}>{line}</li>)}
                      </ul>
                    )}
                    <Source rule={rule} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

/** The rule's source page: a link that opens apart from Chausar on the web; on the desktop its title and address as text. */
function Source({ rule }: { rule: PlatformRuleView }) {
  const t = useT();
  const url = rule.source ? safeUrl(rule.source.url) : null;
  if (!rule.source || !url) return null;
  if (onDesktop()) {
    return <span className={r.address}>{t('business.rules.sourceAt', { title: rule.source.title })} <span>{url}</span></span>;
  }
  return (
    <span className={s.stepWho}>
      <a className={r.source} href={url} target="_blank" rel="noopener noreferrer">{rule.source.title}</a>
    </span>
  );
}
