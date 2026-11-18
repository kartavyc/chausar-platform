import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import type { AiReuseLite } from '../../engine/types';
import { Button } from '../../parts/Button';
import { ComplianceCheck, type ComplianceAnswer } from '../../parts/ComplianceCheck';
import { Icon } from '../../parts/Icon';
import { InlineError } from '../../parts/InlineError';
import { Logo } from '../../parts/Logo';
import { AboutYou, type AboutDraft, type AboutMode, type KeptPlan } from './AboutYou';
import { BusinessNeeds } from './BusinessNeeds';
import { ConnectAi } from './ConnectAi';
import { TEMPLATES } from '../connections/YourAi';
import { ProfessionPick } from './ProfessionPick';
import { StartAtLogin } from './StartAtLogin';
import { Start } from './Start';
import f from './FirstRun.module.css';
import s from './Onboarding.module.css';
import { withViewTransition } from '../../parts/motion';

/** 'reuse': a later business, while the engine connects the AI already used on this computer; then 'about', or 'ai' when it could not. */
type Step = 'reuse' | 'ai' | 'about' | 'who' | 'check' | 'keep' | 'needs';
/** The engine's id for work outside the listed fields (core/compliance-data.ts OWN_WORK): the side-work question alone. */
const OWN_WORK_ID = 'own-work';
const ORDER: readonly Step[] = ['reuse', 'ai', 'about', 'who', 'check', 'keep', 'needs'];
/**
 * How long "Checking this computer" waits for the engine's answer before it shows step 1 anyway. The check looks for each
 * AI tool and runs the tool's own status command, which took up to 39 seconds on a first start on Windows; past a minute
 * the owner is not kept waiting and connects as ever. An answer that comes later is still used.
 */
export const REUSE_WAIT_MS = 60_000;
/** The name the steps row gives a connection, by the preset that serves plans: the sign-in's own name, as ConnectAi says it. */
const AI_NAME_KEY: Readonly<Record<string, string>> = { 'codex-cli': 'first-run.ai.codex.name', 'claude-code-cli': 'first-run.ai.claude.name' };

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
 * (the recovery code shows once).
 *
 * Every business gets these steps, the first and any later one (15 Nov 2026: a second business used to get the old
 * one-sentence start, with no AI conversation). `later`: there is a business on this computer already, so the engine
 * is asked to connect the AI the owner already uses in this new draft (venture.ai.reuse: Codex or Claude Code only, a
 * key never leaves its vault). When it does, step 1 is done and the owner starts at "What work do you do?"; when it
 * cannot, step 1 shows as ever. `backTo`: the business "New business" was pressed in, which Back opens again.
 */
export function FirstRun({ status, onStarted, onBack, onExisting, later = false, backTo }: {
  status: ReactNode; onStarted: () => void; onBack?: (() => void) | undefined; onExisting?: (() => void) | undefined;
  later?: boolean | undefined; backTo?: string | undefined;
}) {
  const t = useT();
  const client = useEngine();
  const reusing = later && client.transport !== 'hosted';
  const [step, setStep] = useState<Step>(reusing ? 'reuse' : 'ai');
  /** One-shot C3: each step hands over to the next in one cross-fade (parts/motion.ts); at once with motion off. */
  const goStep = (next: Step) => { void withViewTransition(() => setStep(next)); };
  const [connected, setConnected] = useState<string | null>(null);
  const [aboutMode, setAboutMode] = useState<AboutMode>('a');
  const [plan, setPlan] = useState<KeptPlan | null>(null);
  /** What the owner typed on step 2 before going back to step 1 to connect an AI; step 2 opens with it again. */
  const [draft, setDraft] = useState<AboutDraft | undefined>(undefined);
  /** A5: the profession the owner confirmed (or the field's id for "None of these"), which the rules step reads. */
  const [profession, setProfession] = useState<string | null>(null);
  const [begun, setBegun] = useState(false);
  const [sideWork, setSideWork] = useState<ComplianceAnswer | null>(null);
  const [inVault, setInVault] = useState(false);
  /** Why the team kept on the plan card was not hired, in the engine's words; setup goes on either way. */
  const [teamProblem, setTeamProblem] = useState<string | null>(null);
  // A later business: the AI already connected on this computer, connected in this draft, once. Any refusal or
  // nothing to reuse is step 1 as ever. The engine is asked once: the answer on its way is kept, and every mount waits
  // on that one answer. (React's strict mode mounts, unmounts and mounts again. The first mount's answer was dropped at
  // its unmount and a ref said "asked", so the second never asked: "Checking this computer" stayed for ever.) With no
  // answer at all the step moves on by itself after REUSE_WAIT_MS, so the owner is never left there.
  const reuse = useRef<Promise<AiReuseLite> | null>(null);
  useEffect(() => {
    if (!reusing) return;
    let live = true;
    const pending = reuse.current ??= client.request('venture.ai.reuse', {});
    /** Out of the checking step, to step 1. An owner who is already past it keeps their place. */
    const toConnect = () => { if (live) setStep((now) => (now === 'reuse' ? 'ai' : now)); };
    const wait = setTimeout(toConnect, REUSE_WAIT_MS);
    pending.then(
      (answer) => {
        if (!live) return;
        clearTimeout(wait);
        const main = answer.tiers.main;
        if (!main.usable || main.presetId === TEMPLATES) { toConnect(); return; }
        // Connected in this draft: step 1 is done, also when the answer came after the wait had shown step 1.
        setConnected(t(AI_NAME_KEY[main.presetId] ?? 'first-run.ai.key.name'));
        setStep((now) => (now === 'reuse' || now === 'ai' ? 'about' : now));
      },
      () => { clearTimeout(wait); toConnect(); },
    );
    return () => { live = false; clearTimeout(wait); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- asked once, when the steps open
  }, []);

  /** A5: the start-at-login tick on the services step; null when it is not asked here. Saved as the owner leaves. */
  const login = useRef<boolean | null>(null);
  const chooseLogin = useCallback((value: boolean | null) => { login.current = value; }, []);

  /**
   * Leaving the services step: the tick is the owner's answer (unticked unless they ticked it), and only now is it applied, before
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
    if (plan?.read.family) await client.request('venture.owner.set', { familyId: plan.read.family.id }).catch(() => undefined);
    // The way to earn the owner kept with the plan (the AI's proposal on the card), so Chats can plan from it.
    if (plan?.read.way) await client.request('venture.owner.set', { way: plan.read.way }).catch(() => undefined);
    // What that way needs from outside, as the AI named it, so the services step lists the plan's own needs.
    if (plan?.read.way && plan.read.needs?.length) await client.request('venture.owner.set', { needs: plan.read.needs }).catch(() => undefined);
    // The team the owner kept on that card, hired now that the business exists (the cards as the engine gave them).
    // A hire that fails never blocks setup: the reason shows on the next step, and agents can be hired later on Team.
    if (plan?.team?.length) await client.request('venture.agents.hire.team', { agents: plan.team }).catch((error: unknown) => setTeamProblem(error instanceof Error ? error.message : String(error)));
    // C4 task 2: the first name asked in About you, now that the business is open; left empty, nothing is written.
    if (plan?.firstName) await client.request('venture.owner.set', { firstName: plan.firstName }).catch(() => undefined);
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
          <Start onStarted={onStarted} onBegin={setBegun} />
          {!begun && onBack && <Button variant="quiet" className={s.back} onClick={onBack}>{backTo ? t('onboarding.welcome.backTo', { name: backTo }) : t('onboarding.welcome.back')}</Button>}
          {!begun && onExisting && <Button variant="quiet" className={s.back} onClick={onExisting}>{t('onboarding.welcome.existing')}</Button>}
        </main>
      </div>
    );
  }

  const past = (target: Step) => ORDER.indexOf(step) > ORDER.indexOf(target);
  const mark = (n: number, done: boolean) => <span className={f.stepMark} aria-hidden="true">{done ? <Icon name="check" size={12} /> : n}</span>;
  const away = !begun && (step === 'reuse' || step === 'ai' || step === 'about' || step === 'who' || step === 'check');
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
              <li className={f.step} aria-current={step === 'ai' || step === 'reuse' ? 'step' : undefined} data-done={past('ai') ? '' : undefined}>
                {mark(1, past('ai'))}{step === 'ai' || step === 'reuse' ? t('first-run.step.ai') : t('first-run.step.templates')}
              </li>
            )}
            <li className={f.step} aria-current={work ? 'step' : undefined} data-done={!work && step !== 'ai' && step !== 'reuse' ? '' : undefined}>{mark(2, !work && step !== 'ai' && step !== 'reuse')}{t('first-run.step.about')}</li>
            <li className={f.step} aria-current={business ? 'step' : undefined}>{mark(3, false)}{t('first-run.step.business')}</li>
          </ol>
        </div>
        {step === 'reuse' && <div className={f.wrap}><p className={f.progress} role="status">{t('first-run.ai.checking')}</p></div>}
        {step === 'ai' && <ConnectAi onDone={(name) => { setConnected(name); goStep('about'); }} onSkip={() => { setConnected(null); goStep('about'); }} />}
        {step === 'about' && <AboutYou connected={connected !== null} onMode={setAboutMode} draft={draft} onConnect={(typed) => { setDraft(typed); setAboutMode('a'); goStep('ai'); }}
          onKeep={(next) => { setPlan(next); setProfession(null); goStep(next.read.family && !next.read.ownKind ? 'who' : 'check'); }} />}
        {/* Work outside the listed fields has no list of professions to pick from: it goes straight to the side-work question.
            So does work the AI read that fits none of its field's professions (the engine's ownKind): the rules step reads the field. */}
        {step === 'who' && plan?.read.family && <ProfessionPick family={plan.read.family} picked={plan.read.profession} onDone={(id) => { setProfession(id); goStep('check'); }} />}
        {step === 'check' && plan && (
          <div className={f.wrap}>
            <h1 className={f.title}>{t('compliance.title')}</h1>
            <ComplianceCheck profession={profession ?? plan.read.family?.id ?? OWN_WORK_ID} record={inVault} headingLevel={2}
              onDone={(answer) => { if (inVault) goStep('needs'); else { setSideWork(answer); goStep('keep'); } }} />
          </div>
        )}
        {step === 'keep' && plan && (
          <div className={f.wrap}>
            <Start onStarted={onStarted} onBegin={setBegun} plan={{ idea: plan.read.idea, countryCode: plan.countryCode, name: plan.name, offers: plan.read.offers, by: plan.read.ownOffers ? 'owner' : plan.read.source === 'ai' ? 'model' : 'template', ...(plan.read.callId ? { callId: plan.read.callId } : {}) }} onKept={kept} />
          </div>
        )}
        {step === 'needs' && teamProblem && <InlineError>{t('first-run.team.failed', { message: teamProblem })}</InlineError>}
        {step === 'needs' && <BusinessNeeds place="first-run" onDone={() => void leave()} ask={<StartAtLogin place="first-run" onChoice={chooseLogin} />} />}
        {away && onBack && <Button variant="quiet" className={f.back} onClick={onBack}>{backTo ? t('onboarding.welcome.backTo', { name: backTo }) : t('onboarding.welcome.back')}</Button>}
        {away && onExisting && <Button variant="quiet" className={f.back} onClick={onExisting}>{t('onboarding.welcome.existing')}</Button>}
      </main>
    </div>
  );
}
