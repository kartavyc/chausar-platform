import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { refusalWords } from '../../parts/custody';
import type { Openable, WelcomeFound } from './boot';
import type { Leaving } from './started';
import { ByFolder, MoveHere, Recover, RestoreBackup } from './WelcomeWays';
import s from './Onboarding.module.css';

type Way = { kind: 'list' } | { kind: 'recover'; folder?: string | undefined } | { kind: 'restore' } | { kind: 'move' } | { kind: 'folder' };

/**
 * Welcome back: no business is open. A quiet list of the businesses on this computer, each opened the way it opens:
 * by this computer's key at once, by its passphrase in a field that opens under its row, or by its recovery code when
 * this computer's key is missing. Below the list, the other ways in the old app had: move a business here from another
 * computer, restore a backup, use a recovery code, and type a folder when the list can't show every business.
 * Hosted keeps the key on the server, so it shows only the list and Start.
 *
 * A passphrase or code lives in its field until it is sent, then the field is cleared; nothing is kept anywhere else.
 */
export function Welcome({ status, found, problem, hosted, onOpen, onOpened, onNew }: {
  status: ReactNode; found: WelcomeFound & { ask?: Leaving['ask'] }; problem: string | null; hosted: boolean;
  onOpen: (business: Openable) => Promise<void>; onOpened: () => void; onNew: () => void;
}) {
  const t = useT();
  const { businesses, complete, ask } = found;
  const [way, setWay] = useState<Way>(ask?.with === 'recovery-code' ? { kind: 'recover', folder: ask.folder } : { kind: 'list' });
  const [asking, setAsking] = useState<string | null>(ask?.with === 'passphrase' ? ask.folder : null);
  const [opening, setOpening] = useState<string | null>(null);
  const back = () => { setAsking(null); setWay({ kind: 'list' }); };

  async function choose(business: Openable) {
    if (business.opens === 'passphrase') { setAsking((now) => (now === business.key ? null : business.key)); return; }
    if (business.opens === 'key-missing') { setWay({ kind: 'recover', folder: business.key }); return; }
    setAsking(null);
    setOpening(business.key);
    try { await onOpen(business); } finally { setOpening(null); }
  }

  if (way.kind !== 'list') {
    const shared = { onOpened, onBack: back };
    return (
      <Shell status={status}>
        {way.kind === 'recover' && <Recover businesses={businesses} chosen={way.folder} {...shared} />}
        {way.kind === 'restore' && <RestoreBackup {...shared} />}
        {way.kind === 'move' && <MoveHere {...shared} />}
        {way.kind === 'folder' && <ByFolder {...shared} />}
      </Shell>
    );
  }

  const empty = businesses.length === 0;
  return (
    <Shell status={status}>
      <h1 className={s.question}>{t('onboarding.welcome.title')}</h1>
      {empty && <p className={s.note}>{t('onboarding.welcome.none')}</p>}
      {!empty && (
        <ul className={s.businesses} aria-label={t('onboarding.welcome.list')}>
          {businesses.map((business) => (
            <li key={business.key}>
              <button
                type="button" className={s.business} disabled={opening !== null}
                aria-expanded={business.opens === 'passphrase' ? asking === business.key : undefined}
                onClick={() => void choose(business)}
              >
                <span>{business.name ?? t('onboarding.welcome.noName')}</span>
                {business.opens !== 'now' && <span className={s.businessNote}>{t(`onboarding.welcome.opens.${business.opens}`)}</span>}
              </button>
              {asking === business.key && (
                <PassphraseOpen business={business} onOpened={onOpened} onForgot={() => setWay({ kind: 'recover', folder: business.key })} />
              )}
            </li>
          ))}
        </ul>
      )}
      <p className={s.progress} role="status">{opening !== null ? t('onboarding.welcome.opening') : ''}</p>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
      <div className={s.actions}>
        <Button variant="quiet" onClick={onNew}>{t(empty ? 'onboarding.welcome.newFirst' : 'onboarding.welcome.new')}</Button>
        {!hosted && <Button variant="quiet" onClick={() => setWay({ kind: 'move' })}>{t('onboarding.welcome.moveHere')}</Button>}
      </div>
      {!hosted && (
        <details className={s.more}>
          <summary>{t('onboarding.welcome.more')}</summary>
          <div className={s.actions}>
            <Button variant="quiet" onClick={() => setWay({ kind: 'restore' })}>{t('onboarding.welcome.restore')}</Button>
            <Button variant="quiet" onClick={() => setWay({ kind: 'recover' })}>{t('onboarding.welcome.useCode')}</Button>
            {(!complete || empty) && <Button variant="quiet" onClick={() => setWay({ kind: 'folder' })}>{t('onboarding.welcome.byFolder')}</Button>}
          </div>
        </details>
      )}
    </Shell>
  );
}

/** The window around Welcome back and its ways in: the status line, the name, one column in the middle. */
function Shell({ status, children }: { status: ReactNode; children: ReactNode }) {
  const t = useT();
  return (
    <div className={s.first}>
      <div>{status}</div>
      <main id="main" tabIndex={-1} className={s.firstMain}>
        <div className={s.alone}>
          <p className={s.name}>{t('app.name')}</p>
          {children}
        </div>
      </main>
    </div>
  );
}

/** A business locked with a passphrase: its own field under its row, cleared once sent; the cursor goes in it. */
function PassphraseOpen({ business, onOpened, onForgot }: { business: Openable; onOpened: () => void; onForgot: () => void }) {
  const t = useT();
  const client = useEngine();
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  const name = business.name ?? t('onboarding.welcome.noName');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!passphrase) { setProblem(t('custody.enterPassphrase')); return; }
    const typed = passphrase;
    setPassphrase('');
    setBusy(true);
    setProblem(null);
    try {
      await client.request('workspace.open', { ...business.params, passphrase: typed });
      onOpened();
    } catch (error) {
      if (live.current) setProblem(refusalWords(error, t));
    } finally {
      if (live.current) setBusy(false);
    }
  }

  return (
    <form className={s.ask} onSubmit={(event) => void submit(event)}>
      <Field
        label={t('onboarding.welcome.passphraseFor', { name })} type="password" autoComplete="current-password" spellCheck={false}
        autoFocus value={passphrase} onChange={(event) => setPassphrase(event.currentTarget.value)}
      />
      {problem && <p className={s.problem} role="alert">{problem}</p>}
      <div className={s.actions}>
        <Button variant="primary" type="submit" disabled={busy}>{t('onboarding.welcome.open')}</Button>
        <Button variant="quiet" onClick={onForgot}>{t('onboarding.welcome.forgot')}</Button>
      </div>
    </form>
  );
}
