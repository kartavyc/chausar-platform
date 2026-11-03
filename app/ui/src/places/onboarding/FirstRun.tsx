import { useState, type ReactNode } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import { ComplianceCheck, type ComplianceAnswer } from '../../parts/ComplianceCheck';
import { Icon } from '../../parts/Icon';
import { Logo } from '../../parts/Logo';
import { AboutYou, type KeptPlan } from './AboutYou';
import { BusinessNeeds } from './BusinessNeeds';
import { ConnectAi } from './ConnectAi';
import { Start } from './Start';
import f from './FirstRun.module.css';
import s from './Onboarding.module.css';

type Step = 'ai' | 'about' | 'check' | 'keep' | 'needs';
const ORDER: readonly Step[] = ['ai', 'about', 'check', 'keep', 'needs'];

/**
 * The first run (W6 6C1, 6C2, 6C6, 6C7; reference-ui/Main.dc.html and OnboardAB.dc.html): Connect your AI, then About
 * you, then the side-work question and the field's rules (6C6, DECISIONS D5: asked once the field is picked, before
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
  const [connected, setConnected] = useState<string | null>(null);
  const [plan, setPlan] = useState<KeptPlan | null>(null);
  const [begun, setBegun] = useState(false);
  const [sideWork, setSideWork] = useState<ComplianceAnswer | null>(null);
  const [inVault, setInVault] = useState(false);

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
      catch { setStep('check'); return; }
    }
    setStep('needs');
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
  const away = !begun && (step === 'ai' || step === 'about' || step === 'check');
  return (
    <div className={f.page}>
      <div>{status}</div>
      <main id="main" tabIndex={-1} className={f.main}>
        <div className={f.top}>
          <span aria-hidden="true"><Logo wordmark size={22} /></span>
          <span className="sr-only">{t('app.name')}</span>
          <ol className={f.steps} aria-label={t('first-run.steps')}>
            <li className={f.step} aria-current={step === 'ai' ? 'step' : undefined} data-done={past('ai') ? '' : undefined}>
              {mark(1, past('ai'))}{step === 'ai' ? t('first-run.step.ai') : connected ? t('first-run.step.connected', { name: connected }) : t('first-run.step.templates')}
            </li>
            <li className={f.step} aria-current={step === 'about' || step === 'check' ? 'step' : undefined} data-done={past('check') ? '' : undefined}>{mark(2, past('check'))}{t('first-run.step.about')}</li>
            <li className={f.step} aria-current={step === 'keep' || step === 'needs' ? 'step' : undefined}>{mark(3, false)}{t('first-run.step.business')}</li>
          </ol>
        </div>
        {step === 'ai' && <ConnectAi onDone={(name) => { setConnected(name); setStep('about'); }} onSkip={() => { setConnected(null); setStep('about'); }} />}
        {step === 'about' && <AboutYou connected={connected !== null} onKeep={(next) => { setPlan(next); setStep('check'); }} />}
        {step === 'check' && plan && (
          <div className={f.wrap}>
            <h1 className={f.title}>{t('compliance.title')}</h1>
            <ComplianceCheck profession={plan.read.family.id} record={inVault}
              onDone={(answer) => { if (inVault) setStep('needs'); else { setSideWork(answer); setStep('keep'); } }} />
          </div>
        )}
        {step === 'keep' && plan && (
          <div className={f.wrap}>
            <Start variant="first-run" onStarted={onStarted} onBegin={setBegun} plan={{ idea: plan.read.idea, countryCode: plan.countryCode, name: plan.name, offers: plan.read.offers, by: plan.read.source === 'ai' ? 'model' : 'template', ...(plan.read.callId ? { callId: plan.read.callId } : {}) }} onKept={kept} />
          </div>
        )}
        {step === 'needs' && <BusinessNeeds place="first-run" onDone={onStarted} />}
        {away && onBack && <Button variant="quiet" className={f.back} onClick={onBack}>{t('onboarding.welcome.back')}</Button>}
        {away && onExisting && <Button variant="quiet" className={f.back} onClick={onExisting}>{t('onboarding.welcome.existing')}</Button>}
      </main>
    </div>
  );
}
