import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLanguageChoice, useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Icon } from '../../parts/Icon';
import { PassphraseField } from '../../parts/PassphraseField';
import { noteOpenedWithPassphrase, refusalWords } from '../../parts/custody';
import type { Openable, WelcomeFound } from './boot';
import type { Leaving } from './started';
import type { Deleted } from '../../engine/types';
import { DeletedNote } from '../business/KeepMore';
import { Brand } from './Start';
import { ByFolder, MoveHere, Recover, RestoreBackup } from './WelcomeWays';
import { OpenCopy } from './CopyImport';
import s from './Onboarding.module.css';
import { Fold } from '../../parts/Fold';
import { Reveal } from '../../parts/RevealBlock';

type Way = { kind: 'list' } | { kind: 'recover'; folder?: string | undefined } | { kind: 'restore' } | { kind: 'move' } | { kind: 'folder' } | { kind: 'copy' };

/**
 * Welcome back: no business is open. A quiet list of the businesses on this computer, each opened the way it opens:
 * by this computer's key at once, by its passphrase in a field that opens under its row, or by its recovery code when
 * this computer's key is missing. Below the list, the other ways in the old app had: move a business here from another
 * computer, restore a backup, use a recovery code, and type a folder when the list can't show every business.
 * Hosted keeps the key on the server, so it shows only the list and Start.
 *
 * A passphrase or code lives in its field until it is sent, then the field is cleared; nothing is kept anywhere else.
 */
export function Welcome({ status, found, problem, hosted, onOpen, onOpened, onNew, deleted = null }: {
  status: ReactNode; found: WelcomeFound & { ask?: Leaving['ask'] }; problem: string | null; hosted: boolean;
  onOpen: (business: Openable) => Promise<void>; onOpened: () => void; onNew: () => void;
  /** B3: the business just deleted: what was removed and the copies kept, above the list. */
  deleted?: Deleted | null;
}) {
  const t = useT();
  const client = useEngine();
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
        {way.kind === 'move' && <MoveHere {...shared} businesses={businesses} onOpen={(business) => { back(); void choose(business); }} />}
        {way.kind === 'folder' && <ByFolder {...shared} />}
        {way.kind === 'copy' && <OpenCopy {...shared} />}
      </Shell>
    );
  }

  const empty = businesses.length === 0;
  const otherWays = [
    <Button key="restore" variant="quiet" onClick={() => setWay({ kind: 'restore' })}>{t('onboarding.welcome.restore')}</Button>,
    <Button key="code" variant="quiet" onClick={() => setWay({ kind: 'recover' })}>{t('onboarding.welcome.useCode')}</Button>,
    ...(client.pickCopy && client.importCopy ? [<Button key="copy" variant="quiet" onClick={() => setWay({ kind: 'copy' })}>{t('onboarding.copy.title')}</Button>] : []),
    ...(!complete || empty ? [<Button key="folder" variant="quiet" onClick={() => setWay({ kind: 'folder' })}>{t('onboarding.welcome.byFolder')}</Button>] : []),
  ];
  return (
    <Shell status={status}>
      <h1 className={s.question}>{t(empty ? 'onboarding.welcome.titleNone' : 'onboarding.welcome.title')}</h1>
      {deleted && <DeletedNote result={deleted} />}
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
                <span className={s.businessEnd} data-open-mark="">
                  {business.opens !== 'now' && <span className={s.businessNote}>{t(`onboarding.welcome.opens.${business.opens}`)}</span>}
                  {business.opens === 'now' && <span className={s.businessNote} aria-hidden="true">{t('onboarding.welcome.open')}</span>}
                  <Icon name="chevron-right" size={16} />
                </span>
              </button>
              <Reveal open={asking === business.key}>
                <PassphraseOpen business={business} onOpened={onOpened} onForgot={() => setWay({ kind: 'recover', folder: business.key })} />
              </Reveal>
            </li>
          ))}
        </ul>
      )}
      <p className={s.progress} role="status">{opening !== null ? t('onboarding.welcome.opening') : ''}</p>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
      {asking === null ? (
        <>
          <div className={s.stacked}>
            {!hosted && empty && <Button variant="primary" onClick={() => setWay({ kind: 'move' })}>{t('onboarding.welcome.moveHere')}</Button>}
            <Button variant="quiet" onClick={onNew}>{t(empty ? 'onboarding.welcome.newFirst' : 'onboarding.welcome.new')}</Button>
            {!hosted && !empty && <Button variant="quiet" onClick={() => setWay({ kind: 'move' })}>{t('onboarding.welcome.moveHere')}</Button>}
          </div>
          <LanguageLink />
          {/* B4 task 12: one chooser for the other ways in; with only two, they are links at rest. */}
          {!hosted && (otherWays.length > 2
            ? <Fold summary={t('onboarding.welcome.bring')} className={s.more}><div className={s.stacked}>{otherWays}</div></Fold>
            : <div className={s.stacked}>{otherWays}</div>)}
        </>
      ) : (
        // While a passphrase is asked it is the way on; the rest wait under More options.
        <Fold summary={t('onboarding.welcome.more')} className={s.more}>
          <div className={s.stacked}>
            <Button variant="quiet" onClick={onNew}>{t('onboarding.welcome.new')}</Button>
            {!hosted && <Button variant="quiet" onClick={() => setWay({ kind: 'move' })}>{t('onboarding.welcome.moveHere')}</Button>}
            {!hosted && otherWays}
          </div>
        </Fold>
      )}
    </Shell>
  );
}

/** C5 task 36: a small link to the other language, in that language's own words. Never picked from the computer. */
function LanguageLink() {
  const { language, available, choose } = useLanguageChoice();
  if (!available) return null;
  const next = language === 'hi' ? 'en' : 'hi';
  return (
    <div className={s.actions}>
      <Button variant="quiet" size="sm" lang={next} onClick={() => void choose(next).catch(() => {})}>{next === 'hi' ? 'हिन्दी' : 'English'}</Button>
    </div>
  );
}

/** The window around Welcome back and its ways in: the status line, the logo, one tile in the middle. */
function Shell({ status, children }: { status: ReactNode; children: ReactNode }) {
  return (
    <div className={s.first}>
      <div>{status}</div>
      <main id="main" tabIndex={-1} className={s.firstMain} data-anchored="">
        <div className={s.aloneFlat}>
          <Brand />
          {children}
        </div>
      </main>
    </div>
  );
}

/**
 * A business locked with a passphrase: its own field under its row, with the cursor in it. C4 task 35 (31.f2): a wrong
 * one stays in the field with the cursor, so a typo can be fixed; once it opens the field is gone with the screen.
 */
function PassphraseOpen({ business, onOpened, onForgot }: { business: Openable; onOpened: () => void; onForgot: () => void }) {
  const t = useT();
  const client = useEngine();
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const live = useRef(true);
  // Set on every mount: StrictMode mounts, unmounts and mounts again, and a flag left false would hide the refusal.
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  const name = business.name ?? t('onboarding.welcome.noName');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!passphrase) { setProblem(t('custody.enterPassphrase')); return; }
    setBusy(true);
    setProblem(null);
    try {
      await client.request('workspace.open', { ...business.params, passphrase });
      noteOpenedWithPassphrase();
      onOpened();
    } catch (error) {
      if (live.current) {
        setProblem(refusalWords(error, t));
        field.current?.focus();
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }

  return (
    <form className={s.ask} onSubmit={(event) => void submit(event)}>
      <PassphraseField
        label={t('onboarding.welcome.passphraseFor', { name })} autoComplete="current-password"
        autoFocus inputRef={field} value={passphrase} onChange={setPassphrase}
      />
      {problem && <p className={s.problem} role="alert">{problem}</p>}
      <div className={s.actions}>
        <Button variant="primary" type="submit" disabled={busy}>{t('onboarding.welcome.open')}</Button>
        <Button variant="quiet" onClick={onForgot}>{t('onboarding.welcome.forgot')}</Button>
      </div>
    </form>
  );
}
