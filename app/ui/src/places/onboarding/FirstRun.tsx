import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import { ComplianceCheck, type ComplianceAnswer } from '../../parts/ComplianceCheck';
import { Icon } from '../../parts/Icon';
import { Logo } from '../../parts/Logo';
import { AboutYou, type AboutMode, type KeptPlan } from './AboutYou';
import { BusinessNeeds } from './BusinessNeeds';
import { ConnectAi } from './ConnectAi';
import { ProfessionPick } from './ProfessionPick';
import { StartAtLogin } from './StartAtLogin';
import { Start } from './Start';
import f from './FirstRun.module.css';
import s from './Onboarding.module.css';
import { withViewTransition } from '../../parts/motion';

type Step = 'ai' | 'about' | 'who' | 'check' | 'keep' | 'needs';
const ORDER: readonly Step[] = ['ai', 'about', 'who', 'check', 'keep', 'needs'];

/**
 * The first run (W6 6C1, 6C2, 6C6, 6C7; reference-ui/Main.dc.html and OnboardAB.dc.html): Connect your AI, then About
 * you, then "Which of these are you?" (one-shot A5, founder answer 3a: the AI's pick of the exact profession, or the
 * owner's own), then the side-work question and the field's rules (6C6, DECISIONS D5: asked once the field is picked, before
 * anything is kept, and recorded right after venture.create), then the plan is kept (the vault, a passphrase only
 * where this computer has no protected storage, the recovery code the engine shows once), then Connect what your
 * business needs, then Today. The top bar names the three steps.
 *
 * Reached from Welcome back it also offers the way back to the businesses on this computer; on a computer with no
 * business yet it offers one quiet way to a business that already exists. Both ways away go once keeping has begun
 * (the open business may be locked on the way, and the recovery code shows once).
 */
export function FirstRun({ status, onStarted, onBack, onExisting }: {
  status: ReactNode; onStarted: () => void; onBack?: (() => void) | undefined; onExisting?: (() => void) | undefined;
}) {
  const t = useT();
  const client = useEngine();
  const [step, setStep] = useState<Step>('ai');
  /** One-shot C3: each step hands over to the next in one cross-fade (parts/motion.ts); at once with motion off. */
  const goStep = (next: Step) => { void withViewTransition(() => setStep(next)); };
  const [connected, setConnected] = useState<string | null>(null);
  const [aboutMode, setAboutMode] = useState<AboutMode>('a');
  const [plan, setPlan] = useState<KeptPlan | null>(null);
  /** A5: the profession the owner confirmed (or the field's id for "None of these"), which the rules step reads. */
  const [profession, setProfession] = useState<string | null>(null);
  const [begun, setBegun] = useState(false);
  const [sideWork, setSideWork] = useState<ComplianceAnswer | null>(null);
  const [inVault, setInVault] = useState(false);
  /** A5: the start-at-login tick on the services step; null when it is not asked here. Saved as the owner leaves. */
  const login = useRef<boolean | null>(null);
  const chooseLogin = useCallback((value: boolean | null) => { login.current = value; }, []);

  /**
   * Leaving the services step: the tick is the owner's answer (ticked by default), and only now is it applied, before
   * Today opens, so Today never asks again. With no answer (the computer had not answered yet), Today asks once.
   */
  async function leave() {
    const value = login.current;
    if (value !== null && client.setBackground) await client.setBackground({ startAtLogin: value }).catch(() => { /* Today asks again; Settings shows the computer. */ });
    onStarted();
  }

  /**
   * The plan is in the vault: remember the field it was kept with (for Connections), record the side-work answer (and
   * any size ranges picked) given before the business existed, then the services step. If that record fails, the
   * question shows again and records itself.
   */
  async function kept() {
    if (plan) await client.request('venture.owner.set', { familyId: plan.read.family.id }).catch(() => undefined);
    setInVault(true);
    if (sideWork) {
      try { await client.request('venture.compliance.set', { profession: sideWork.profession, sideWork: sideWork.sideWork, digest: sideWork.digest, ...(sideWork.size ? { size: sideWork.size } : {}) }); }
      catch { goStep('check'); return; }
    }
    goStep('needs');
  }

  // The hosted web app adds an AI only after a business is kept (the draft desk is desktop only): its first run stays
  // the one-sentence start, with the template plan.
  if (client.transport === 'hosted') {
    return (
      <div className={s.first}>
        <div>{status}</div>
        <main id="main" tabIndex={-1} className={s.firstMain}>
          <Start variant="first-run" onStarted={onStarted} onBegin={setBegun} />
          {!begun && onBack && <Button variant="quiet" className={s.back} onClick={onBack}>{t('onboarding.welcome.back')}</Button>}
          {!begun && onExisting && <Button variant="quiet" className={s.back} onClick={onExisting}>{t('onboarding.welcome.existing')}</Button>}
        </main>
      </div>
    );
  }

  const past = (target: Step) => ORDER.indexOf(step) > ORDER.indexOf(target);
  const mark = (n: number, done: boolean) => <span className={f.stepMark} aria-hidden="true">{done ? <Icon name="check" size={12} /> : n}</span>;
  const away = !begun && (step === 'ai' || step === 'about' || step === 'who' || step === 'check');
  // C1 task 11: step 2, "Your work", is About you before the plan card; step 3 runs from the plan card to the end.
  const work = step === 'about' && aboutMode !== 'plan';
  const business = (step === 'about' && aboutMode === 'plan') || step === 'who' || step === 'check' || step === 'keep' || step === 'needs';
  return (
    <div className={f.page}>
      <div>{status}</div>
      <main id="main" tabIndex={-1} className={f.main}>
        <div className={f.top}>
          <span aria-hidden="true"><Logo wordmark size={22} /></span>
          <span className="sr-only">{t('app.name')}</span>
          <ol className={f.steps} aria-label={t('first-run.steps')}>
            {/* C1 task 11: step 1 keeps one short label; after a connect, what was connected is its title and is said to
                screen readers, so the row never grows. */}
            {step !== 'ai' && connected ? (
              <li className={f.step} data-done="" title={t('first-run.step.connected', { name: connected })}>
                {mark(1, true)}<span aria-hidden="true" data-step-word="">{t('first-run.step.aiDone')}</span><span className="sr-only">{t('first-run.step.connected', { name: connected })}</span>
              </li>
            ) : (
              <li className={f.step} aria-current={step === 'ai' ? 'step' : undefined} data-done={past('ai') ? '' : undefined}>
                {mark(1, past('ai'))}{step === 'ai' ? t('first-run.step.ai') : t('first-run.step.templates')}
              </li>
            )}
            <li className={f.step} aria-current={work ? 'step' : undefined} data-done={!work && step !== 'ai' ? '' : undefined}>{mark(2, !work && step !== 'ai')}{t('first-run.step.about')}</li>
            <li className={f.step} aria-current={business ? 'step' : undefined}>{mark(3, false)}{t('first-run.step.business')}</li>
          </ol>
        </div>
        {step === 'ai' && <ConnectAi onDone={(name) => { setConnected(name); goStep('about'); }} onSkip={() => { setConnected(null); goStep('about'); }} />}
        {step === 'about' && <AboutYou connected={connected !== null} onMode={setAboutMode} onKeep={(next) => { setPlan(next); setProfession(null); goStep('who'); }} />}
        {step === 'who' && plan && <ProfessionPick family={plan.read.family} picked={plan.read.profession} onDone={(id) => { setProfession(id); goStep('check'); }} />}
        {step === 'check' && plan && (
          <div className={f.wrap}>
            <h1 className={f.title}>{t('compliance.title')}</h1>
            <ComplianceCheck profession={profession ?? plan.read.family.id} record={inVault} headingLevel={2}
              onDone={(answer) => { if (inVault) goStep('needs'); else { setSideWork(answer); goStep('keep'); } }} />
          </div>
        )}
        {step === 'keep' && plan && (
          <div className={f.wrap}>
            <Start variant="first-run" onStarted={onStarted} onBegin={setBegun} plan={{ idea: plan.read.idea, countryCode: plan.countryCode, name: plan.name, offers: plan.read.offers, by: plan.read.source === 'ai' ? 'model' : 'template', ...(plan.read.callId ? { callId: plan.read.callId } : {}) }} onKept={kept} />
          </div>
        )}
        {step === 'needs' && <BusinessNeeds place="first-run" onDone={() => void leave()} ask={<StartAtLogin place="first-run" onChoice={chooseLogin} />} />}
        {away && onBack && <Button variant="quiet" className={f.back} onClick={onBack}>{t('onboarding.welcome.back')}</Button>}
        {away && onExisting && <Button variant="quiet" className={f.back} onClick={onExisting}>{t('onboarding.welcome.existing')}</Button>}
      </main>
    </div>
  );
}
