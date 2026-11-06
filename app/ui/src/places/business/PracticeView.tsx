import { useEffect, useRef, useState } from 'react';
import { useT } from '../../text';
import { useOwnerZone } from '../../shell/clock';
import { openSheet, useRoute } from '../../shell/navigation';
import { useEngine, useResource } from '../../engine/context';
import { keepPracticeDraft, practiceDraftId } from '../work/practice-drafts';
import { Button } from '../../parts/Button';
import type { EpisodeLite, ImprovementRunLite, ScenarioLite, SimulationRunLite, VentureRunEvent } from '../../engine/types';
import { TileSection, dayOf, messageOf } from './shared';
// W4 4J22a: drills (4J15), experiments (4J16) and the guidance report (4J16).
import { Drills, Experiments } from './Drills';
import { GuidanceReport } from './GuidanceReport';
// W6 6C4: the two launch stages and the button that moves the business up.
import { LaunchStages } from './LaunchStages';
import s from './Business.module.css';

/**
 * Business > Practice and improve (#/business/practice), Ink v2 wave 2 (catalogue Q2's screen, and the judge setting
 * the founder chose on 23 Oct). Three parts, each reading the engine and showing its words:
 *   Practice clients   the template made-up clients (venture.simulation.scenarios) and "Rehearse now"
 *                      (venture.simulation.run with no client named, which runs exactly those), then how many passed,
 *                      each failed client's first failure, the cost and who wrote the drafts, as the engine wrote them.
 *                      Cases made from the owner's feedback are listed apart: they are what the loop learns from
 *   Improve            the readiness line, "Run the improvement loop" (venture.improve.run), a kept version's changes
 *                      with "Use this version" (venture.improve.adopt, asked twice), and the version in use with
 *                      "Go back to version N" (venture.improve.rollback, asked twice) when the engine would take it
 *   The judge          whether the judge reads every draft for a client or the public on its own (venture.judge.auto),
 *                      with the engine's line; turning it on asks first, since it is a standing consent
 * Nothing is counted or priced here: every number and every refusal is the engine's. In the D look each part is a
 * tile; the loop and the judge sit side by side.
 */
export function PracticeView() {
  const t = useT();
  // C4 task 17: Suggest fixes under a rehearsal's result runs the loop; the Improve tile reads it and lands on Use this version.
  const [suggested, setSuggested] = useState(0);
  return (
    <div className={s.page}>
      <p className={s.lead}>{t('business.practice.lead')}</p>
      <LaunchStages />
      <Rehearsal onSuggested={() => setSuggested((count) => count + 1)} />
      <div className={s.split} data-ratio="even">
        <Improvement suggested={suggested} />
        <JudgeSetting />
      </div>
      {/* W4 4J22a: the drills against the version in use, and each guidance line with the check that sees it. */}
      <Drills />
      <GuidanceReport />
    </div>
  );
}

const onQueue = (event: VentureRunEvent) => event.type === 'queue.changed';

/** A second ask under a button: the question, Not now (focused first) and the action again. */
function Confirm({ ask, label, onConfirm, onCancel }: { ask: string; label: string; onConfirm: () => void; onCancel: () => void }) {
  const t = useT();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelRef.current?.focus(); }, []);
  return (
    <div className={s.foldBody} data-second-ask="">
      <p className={s.line}>{ask}</p>
      <div className={s.buttons}>
        <Button ref={cancelRef} variant="quiet" onClick={onCancel}>{t('approval.cancel')}</Button>
        <Button variant="primary" onClick={onConfirm}>{label}</Button>
      </div>
    </div>
  );
}

/** What failed first in an episode, in the engine's words: the failed check's own detail, else what the engine named. */
function failureOf(episode: EpisodeLite): string {
  const named = episode.firstFailure ?? '';
  return episode.checks.find((c) => c.check === named && !c.passed)?.detail
    ?? episode.playbookChecks?.find((c) => c.check === named && c.outcome === 'fail')?.detail
    ?? named;
}

function Rehearsal({ onSuggested }: { onSuggested: () => void }) {
  const t = useT();
  const client = useEngine();
  const scenarios = useResource('venture.simulation.scenarios', {}, { refreshOn: onQueue });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SimulationRunLite | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState<string | null>(null);

  async function rehearse() {
    setBusy(true);
    setProblem(null);
    setSuggested(null);
    try {
      setResult(await client.request('venture.simulation.run', {}));
    } catch (error) {
      setProblem(t('business.practice.rehearseFailed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  /** C4 task 17: the same venture.improve.run as the Improve tile, from this result. */
  async function suggest() {
    setSuggesting(true);
    setProblem(null);
    try {
      const run = await client.request('venture.improve.run', {});
      setSuggested(run.status === 'kept-candidate' ? t('business.practice.suggested') : latestLine(run, t));
      onSuggested();
    } catch (error) {
      setProblem(t('business.practice.runFailed', { message: messageOf(error) }));
    } finally {
      setSuggesting(false);
    }
  }

  const list: ScenarioLite[] = scenarios.data ?? [];
  // "Rehearse now" asks for no client by name, so the engine runs the template practice clients only. Cases made from
  // the owner's feedback are listed apart: they are what the improvement loop learns from.
  const templates = list.filter((scenario) => scenario.source === 'template');
  const cases = list.filter((scenario) => scenario.source === 'signal');
  const title = (scenarioId: string) => list.find((scenario) => scenario.id === scenarioId)?.title ?? scenarioId;
  // Each failed client once: its first failed episode.
  const failed = (result?.episodes ?? []).filter((episode, index, all) => !episode.passed && all.findIndex((e) => e.scenarioId === episode.scenarioId && !e.passed) === index);
  // C4 task 17: each practice client once, its failed episode when it has one; a row with a draft opens it.
  const rows = (result?.episodes ?? []).filter((episode, index, all) => (failed.includes(episode) || (!failed.some((e) => e.scenarioId === episode.scenarioId) && all.findIndex((e) => e.scenarioId === episode.scenarioId) === index)));
  const openDraft = (episode: EpisodeLite, origin: HTMLElement) => {
    const id = practiceDraftId(result!.id, episode);
    keepPracticeDraft(client, id, { client: title(episode.scenarioId), text: episode.renderedText ?? '', checks: episode.checks });
    openSheet('draft', id, origin);
  };
  const mode = result ? modeLine(result.modelMode, t) : null;
  return (
    <>
      <TileSection title={t('business.practice.clients')}>
        {scenarios.error && <p className={s.problem} role="alert">{t('business.failed', { message: scenarios.error.message })}</p>}
        {!scenarios.data && !scenarios.error && <p className={s.note}>{t('business.loading')}</p>}
        {scenarios.data && templates.length === 0 && <p className={s.line}>{t('business.practice.none')}</p>}
        {templates.length > 0 && <ScenarioList scenarios={templates} />}
        <div className={s.buttons}>
          <Button disabled={busy || templates.length === 0} onClick={() => void rehearse()}>{busy ? t('business.practice.rehearsing') : t('business.practice.rehearse')}</Button>
        </div>
        <p className={s.note}>{t('business.practice.ownAi')}</p>
        {problem && <p className={s.problem} role="alert">{problem}</p>}
        {result && (
          <div className={s.foldBody} data-rehearsal={result.id}>
            <p className={s.strong} role="status">{t('business.practice.result', { passed: String(result.summary.passed), total: String(result.summary.scenarios) })}</p>
            {rows.length > 0 && (
              <ul className={s.log}>
                {rows.map((episode) => {
                  const words = episode.passed ? t('business.practice.passedRow', { client: title(episode.scenarioId) }) : t('business.practice.failure', { client: title(episode.scenarioId), failure: failureOf(episode) });
                  return (
                    <li key={`${episode.scenarioId}-${episode.index}`}>
                      {episode.renderedText ? <button type="button" className={s.rowLink} onClick={(event) => openDraft(episode, event.currentTarget)}>{words}</button> : words}
                    </li>
                  );
                })}
              </ul>
            )}
            {failed.length > 0 && (
              <div className={s.buttons}>
                <Button disabled={suggesting} onClick={() => void suggest()}>{suggesting ? t('business.practice.running') : t('business.practice.suggest')}</Button>
              </div>
            )}
            {suggested && <p className={s.line} role="status">{suggested}</p>}
            {/* What the run cost, as the engine writes it, with no receipt until W4 4J1: its words, marked so. */}
            <p className={s.note} data-engine-line="">{t('business.practice.cost', { cost: result.costDisplay })}</p>
            {mode && <p className={s.note}>{mode}</p>}
          </div>
        )}
      </TileSection>
      {cases.length > 0 && <FeedbackCases cases={cases} />}
    </>
  );
}

function ScenarioList({ scenarios }: { scenarios: ScenarioLite[] }) {
  return (
    <ul className={s.steps}>
      {scenarios.map((scenario) => (
        <li key={scenario.id} className={s.step} data-practice-client={scenario.source === 'template' ? scenario.id : undefined} data-feedback-case={scenario.source === 'signal' ? scenario.id : undefined}>
          <span>{scenario.title}</span>
          <span className={s.stepWho}>{scenario.persona}</span>
        </li>
      ))}
    </ul>
  );
}

/** Cases the engine made from drafts the owner rejected or edited, or that failed a check: what the judge and the loop learn from. */
function FeedbackCases({ cases }: { cases: ScenarioLite[] }) {
  const t = useT();
  return (
    <TileSection title={t('business.practice.cases')}>
      <p className={s.line}>{t('business.practice.casesLine')}</p>
      <ScenarioList scenarios={cases} />
    </TileSection>
  );
}

/** Who wrote a rehearsal or a loop's drafts, when it was not only the owner's AI: templates, or a mix. */
function modeLine(mode: SimulationRunLite['modelMode'], t: ReturnType<typeof useT>): string | null {
  return mode === 'template' ? t('business.fromTemplates') : mode === 'mixed' ? t('business.practice.mixed') : null;
}

/** The newest improvement run in one plain line. */
function latestLine(run: ImprovementRunLite, t: ReturnType<typeof useT>): string {
  return run.status === 'incomplete'
    ? t('business.practice.latest.incomplete', { reason: run.incompleteReason ?? '' })
    : t(`business.practice.latest.${run.status}`);
}

function Improvement({ suggested }: { suggested: number }) {
  const t = useT();
  const client = useEngine();
  const route = useRoute();
  const status = useResource('venture.improve.status', {});
  const adoptRef = useRef<HTMLButtonElement>(null);
  // C4 task 17: Work's row (#/business/practice?focus=adopt) and Suggest fixes land on Use this version.
  const wantsAdopt = route.query.focus === 'adopt';
  const landed = useRef(false);
  useEffect(() => { if (suggested > 0) { landed.current = false; status.reload(); } }, [suggested]);
  const [phase, setPhase] = useState<'idle' | 'running' | 'adopt' | 'rollback' | 'busy'>('idle');
  const [problem, setProblem] = useState<string | null>(null);

  async function act(work: () => Promise<unknown>, failed: string) {
    setPhase('busy');
    setProblem(null);
    try {
      await work();
    } catch (error) {
      setProblem(t(failed, { message: messageOf(error) }));
    } finally {
      setPhase('idle');
      status.reload();
    }
  }

  async function run() {
    setPhase('running');
    setProblem(null);
    try {
      await client.request('venture.improve.run', {});
    } catch (error) {
      setProblem(t('business.practice.runFailed', { message: messageOf(error) }));
    } finally {
      setPhase('idle');
      status.reload();
    }
  }

  const data = status.data;
  const candidate = data?.candidate ?? null;
  const inUse = data?.inUse ?? null;
  const rollback = inUse?.rollback ?? null;
  const landOn = (wantsAdopt || suggested > 0) && !!candidate;
  useEffect(() => {
    if (!landOn || landed.current || !adoptRef.current) return;
    landed.current = true;
    adoptRef.current.focus();
    adoptRef.current.scrollIntoView?.({ block: 'center' });
  }, [landOn, candidate?.runId, suggested]);
  return (
    <TileSection title={t('business.practice.improve')}>
      {status.error && !data && <p className={s.problem} role="alert">{t('business.failed', { message: status.error.message })}</p>}
      {!data && !status.error && <p className={s.note}>{t('business.loading')}</p>}
      {data && (
        <>
          <p className={s.line}>{data.readiness.reason}</p>
          {data.latest && (
            <>
              <p className={s.line}>{latestLine(data.latest, t)}</p>
              <p className={s.note} data-engine-line="">{t('business.practice.cost', { cost: data.latest.costDisplay })}</p>
              {modeLine(data.latest.modelMode, t) && <p className={s.note}>{modeLine(data.latest.modelMode, t)}</p>}
            </>
          )}
          <div className={s.buttons}>
            <Button disabled={data.readiness.status !== 'available' || phase !== 'idle'} onClick={() => void run()}>
              {phase === 'running' ? t('business.practice.running') : t('business.practice.run')}
            </Button>
          </div>
          <p className={s.note}>{t('business.practice.ownAi')}</p>
          {/* W4 4J22a: each change the newest run tried, as an experiment with its control. */}
          <Experiments run={data.latest} />
          {candidate && (
            <div className={s.foldBody} data-candidate={candidate.runId}>
              <p className={s.strong}>{t('business.practice.changes')}</p>
              <ul className={s.plain}>
                {candidate.changes.map((change) => <li key={change}>{change}</li>)}
              </ul>
              {phase === 'adopt' ? (
                <Confirm
                  ask={t('business.practice.adoptAsk')} label={t('business.practice.adopt')}
                  onCancel={() => setPhase('idle')}
                  onConfirm={() => void act(() => client.request('venture.improve.adopt', { runId: candidate.runId, digest: candidate.digest }), 'business.practice.adoptFailed')}
                />
              ) : (
                <div className={s.buttons}>
                  <Button ref={adoptRef} disabled={phase !== 'idle'} onClick={() => { setProblem(null); setPhase('adopt'); }}>{t('business.practice.adopt')}</Button>
                </div>
              )}
            </div>
          )}
          {inUse && (
            <div className={s.foldBody} data-in-use={inUse.playbookId}>
              <p className={s.strong}>{t(`business.practice.inUse.${inUse.origin}`, { version: String(inUse.version) })}</p>
              {rollback && (phase === 'rollback' ? (
                <Confirm
                  ask={t('business.practice.rollbackAsk', { version: String(rollback.version) })} label={t('business.practice.rollback', { version: String(rollback.version) })}
                  onCancel={() => setPhase('idle')}
                  onConfirm={() => void act(() => client.request('venture.improve.rollback', { playbookId: rollback.playbookId, digest: rollback.digest }), 'business.practice.rollbackFailed')}
                />
              ) : (
                <div className={s.buttons}>
                  <Button disabled={phase !== 'idle'} onClick={() => { setProblem(null); setPhase('rollback'); }}>{t('business.practice.rollback', { version: String(rollback.version) })}</Button>
                </div>
              ))}
            </div>
          )}
          {problem && <p className={s.problem} role="alert">{problem}</p>}
        </>
      )}
    </TileSection>
  );
}

function JudgeSetting() {
  const t = useT();
  const zone = useOwnerZone();
  const client = useEngine();
  const setting = useResource('venture.judge.auto.get', {}, { refreshOn: onQueue });
  const [phase, setPhase] = useState<'idle' | 'ask' | 'busy'>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const view = setting.data;

  // After each change the page reads the setting again, so it always shows the engine's state, including a consent
  // recorded elsewhere (sending the automatic judge call from Work).
  async function set(auto: boolean) {
    setPhase('busy');
    setProblem(null);
    try {
      await client.request('venture.judge.auto.set', { auto });
    } catch (error) {
      setProblem(t('business.practice.judgeFailed', { message: messageOf(error) }));
    } finally {
      setPhase('idle');
      setting.reload();
    }
  }

  return (
    <TileSection title={t('business.practice.judge')}>
      {setting.error && !view && <p className={s.problem} role="alert">{t('business.failed', { message: setting.error.message })}</p>}
      {!view && !setting.error && <p className={s.note}>{t('business.loading')}</p>}
      {view && (
        <>
          <p className={s.strong}>{view.auto ? t('business.practice.judgeOn') : t('business.practice.judgeOff')}</p>
          <p className={s.line}>{view.line}</p>
          {view.auto && view.consentAt && <p className={s.note}>{t('business.practice.consent', { day: dayOf(view.consentAt, zone) })}</p>}
          {phase === 'ask' ? (
            <Confirm ask={t('business.practice.turnOnAsk')} label={t('business.practice.turnOn')} onCancel={() => setPhase('idle')} onConfirm={() => void set(true)} />
          ) : (
            <div className={s.buttons}>
              {view.auto
                ? <Button disabled={phase !== 'idle'} onClick={() => void set(false)}>{t('business.practice.turnOff')}</Button>
                : <Button disabled={phase !== 'idle'} onClick={() => { setProblem(null); setPhase('ask'); }}>{t('business.practice.turnOn')}</Button>}
            </div>
          )}
          {problem && <p className={s.problem} role="alert">{problem}</p>}
        </>
      )}
    </TileSection>
  );
}
