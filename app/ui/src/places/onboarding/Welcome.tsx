import { useState, type ReactNode } from 'react';
import { useT } from '../../text';
import { Button } from '../../parts/Button';
import type { Openable } from './boot';
import s from './Onboarding.module.css';

/**
 * Welcome back: businesses are on this computer but none is open. A quiet list to open one, and a way to start
 * another. A business that opens with its passphrase or a recovery code says so: asking for either belongs to a trusted
 * host control the app does not have yet, so nothing here asks for one.
 */
export function Welcome({ status, businesses, problem, onOpen, onNew }: {
  status: ReactNode; businesses: Openable[]; problem: string | null;
  onOpen: (business: Openable) => Promise<void>; onNew: () => void;
}) {
  const t = useT();
  const [opening, setOpening] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function choose(business: Openable) {
    const name = business.name ?? t('onboarding.welcome.noName');
    setNotice(null);
    if (business.opens === 'passphrase') { setNotice(t('onboarding.welcome.passphrase', { name })); return; }
    if (business.opens === 'key-missing') { setNotice(t('onboarding.welcome.keyMissing', { name })); return; }
    setOpening(business.key);
    try { await onOpen(business); } finally { setOpening(null); }
  }

  return (
    <div className={s.first}>
      <div>{status}</div>
      <main id="main" tabIndex={-1} className={s.firstMain}>
        <div className={s.alone}>
          <p className={s.name}>{t('app.name')}</p>
          <h1 className={s.question}>{t('onboarding.welcome.title')}</h1>
          <ul className={s.businesses} aria-label={t('onboarding.welcome.list')}>
            {businesses.map((business) => (
              <li key={business.key}>
                <button type="button" className={s.business} disabled={opening !== null} onClick={() => void choose(business)}>
                  <span>{business.name ?? t('onboarding.welcome.noName')}</span>
                  {business.opens !== 'now' && <span className={s.businessNote}>{t(`onboarding.welcome.opens.${business.opens}`)}</span>}
                </button>
              </li>
            ))}
          </ul>
          <p className={s.progress} role="status">{opening !== null ? t('onboarding.welcome.opening') : notice ?? ''}</p>
          {problem && <p className={s.problem} role="alert">{problem}</p>}
          <div className={s.actions}>
            <Button variant="quiet" onClick={onNew}>{t('onboarding.welcome.new')}</Button>
          </div>
        </div>
      </main>
    </div>
  );
}
