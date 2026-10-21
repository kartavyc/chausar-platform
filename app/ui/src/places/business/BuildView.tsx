import { useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { ModelEstimate } from '../../parts/ModelEstimate';
import { EngineError, type BuildStatusView, type BuilderId } from '../../engine/types';
import { ExternalLink, openProblem } from '../connections/external';
import { BUILDER_NAMES, handOff } from './handoff';
import { messageOf } from './shared';
import s from './Business.module.css';

const SYNTHETIC = /synthetic recording/i;

/**
 * Website build (venture.build.*): the brief Chausar writes from the accepted plan, handed to Lovable or Replit through
 * the engine's own link (the owner presses send there), and the repo followed read-only on GitHub, its state in plain
 * words. A deployment address is shown as text, never as a link. The read-only key is sent once and never shown.
 */
export function BuildView() {
  const t = useT();
  const client = useEngine();
  const build = useResource('venture.build.status', {});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function writeBrief() {
    setBusy(true);
    setProblem(null);
    try {
      await client.request('venture.build.brief', {});
      build.reload();
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  if (build.error) return <p className={s.problem} role="alert">{t('business.failed', { message: build.error.message })}</p>;
  if (!build.data) return <p className={s.note}>{t('business.loading')}</p>;
  const { brief } = build.data;

  return (
    <>
      <section className={s.section} aria-label={t('business.briefTitle')}>
        <h2 className={s.heading}>{t('business.briefTitle')}</h2>
        {!brief ? (
          <>
            <p className={s.line}>{t('business.noBrief')}</p>
            <div className={s.buttons}><Button variant="primary" disabled={busy} onClick={() => void writeBrief()}>{t('business.writeBrief')}</Button></div>
          </>
        ) : (
          <>
            <p className={s.line}>
              {brief.lint.ok ? t('business.briefChecks', { chars: brief.chars }) : t('business.briefNotReady', { finding: brief.lint.findings[0]?.message ?? '' })}
              {brief.estimate && <> <ModelEstimate /></>}
            </p>
            {brief.wordsBy === 'template' && <p className={s.note}>{t('business.fromTemplates')}</p>}
            <details className={s.fold}>
              <summary>{t('business.readBrief')}</summary>
              <pre className={s.pre}>{brief.markdown}</pre>
            </details>
            <div className={s.buttons}><Button variant="quiet" disabled={busy} onClick={() => void writeBrief()}>{t('business.writeAgain')}</Button></div>
          </>
        )}
        {problem && <p className={s.problem} role="alert">{problem}</p>}
      </section>
      {brief && <Builders status={build.data} ready={brief.lint.ok} onOpened={build.reload} />}
      <GitHub status={build.data} onChanged={build.reload} />
    </>
  );
}

function Builders({ status, ready, onOpened }: { status: BuildStatusView; ready: boolean; onOpened: () => void }) {
  const t = useT();
  const client = useEngine();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ lines: string[]; problem: string | null } | null>(null);

  async function open(builder: BuilderId) {
    setSaid(null);
    const started = handOff(client, builder); // first, so the web tab opens inside the click
    setBusy(true);
    try {
      const { plan, done } = await started;
      const name = BUILDER_NAMES[builder];
      const line = done === 'opened' ? t('business.opened', { name }) : done === 'copied' ? t('business.copied', { name }) : null;
      setSaid({ lines: [...(line ? [line] : []), ...plan.notes], problem: null });
      onOpened();
    } catch (error) {
      const code = error instanceof EngineError ? error.code : '';
      setSaid({ lines: [], problem: code === 'COPY_FAILED' ? t('connections.copyFailed') : openProblem(error, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={s.section} aria-label={t('business.builders')}>
      <h2 className={s.heading}>{t('business.builders')}</h2>
      <div className={s.buttons}>
        <Button variant="primary" disabled={busy || !ready} onClick={() => void open('lovable')}>{t('business.openLovable')}</Button>
        <Button disabled={busy || !ready} onClick={() => void open('replit')}>{t('business.openReplit')}</Button>
      </div>
      <p className={s.note}>{t('business.replitNote')}</p>
      {said?.lines.map((line) => <p key={line} className={s.said} role="status">{line}</p>)}
      {said?.problem && <p className={s.problem} role="alert">{said.problem}</p>}
      {status.handoffs.length > 0 && (
        <details className={s.fold}>
          <summary>{t('business.handoffs')}</summary>
          <ul className={s.plain}>
            {status.handoffs.slice(0, 4).map((handoff) => (
              <li key={handoff.id}>{t(handoff.openedAt ? 'business.handoffOpened' : 'business.handoffNotOpened', { name: BUILDER_NAMES[handoff.builder] })}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function GitHub({ status, onChanged }: { status: BuildStatusView; onChanged: () => void }) {
  const t = useT();
  const client = useEngine();
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const follow = status.follow;
  const current = follow?.lastStatus ?? null;

  async function check() {
    setBusy(true);
    setProblem(null);
    try {
      await client.request('venture.build.sync', {});
      onChanged();
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  if (!follow || changing) {
    return (
      <section className={s.section} aria-label={t('business.followTitle')}>
        <h2 className={s.heading}>{t('business.followTitle')}</h2>
        <FollowForm tokenLink={status.tokenLink} initial={follow ? `${follow.repo.owner}/${follow.repo.name}` : ''} onDone={() => { setChanging(false); onChanged(); }} />
      </section>
    );
  }
  const repoName = `${follow.repo.owner}/${follow.repo.name}`;
  return (
    <section className={s.section} aria-label={t('business.github')}>
      <h2 className={s.heading}>{t('business.github')}</h2>
      {!current ? (
        <p className={s.line}>{t('business.notRead', { repo: repoName })}</p>
      ) : (
        <>
          <p className={s.strong}>
            <span>{t(`business.buildWord.${current.word}`)}</span>
            {current.syncConflictBranch && <span> {t('business.onBranch', { branch: current.syncConflictBranch })}</span>}
            <span className={`${s.repo} mono`}>{repoName}</span>
          </p>
          {current.uiWorkflow === 'needs-fix' || current.uiWorkflow === 'missing' ? <p className={s.warn}>{t(`business.workflow.${current.uiWorkflow}`)}</p> : null}
          {current.lastCommit && (
            <p className={s.line}>{t('business.lastChange', { message: current.lastCommit.message, by: t(`business.commitBy.${current.lastCommit.by}`) })}</p>
          )}
          <p className={s.note}>{t(`business.marker.${current.briefMarker}`)} {t(`business.checks.${current.checks}`)}</p>
          {current.deployment && (
            <p className={s.line}>{t('business.address')} <span className="mono">{current.deployment.url}</span></p>
          )}
          {/* A recording is said at rest; the other limits wait one fold away. */}
          {current.cannotSay.filter((line) => SYNTHETIC.test(line)).map((line) => <p key={line} className={s.note}>{line}</p>)}
          {current.cannotSay.some((line) => !SYNTHETIC.test(line)) && (
            <details className={s.fold}>
              <summary>{t('business.cannotSay')}</summary>
              {current.cannotSay.filter((line) => !SYNTHETIC.test(line)).map((line) => <p key={line} className={s.line}>{line}</p>)}
            </details>
          )}
        </>
      )}
      <div className={s.buttons}>
        <Button disabled={busy} onClick={() => void check()}>{t('business.check')}</Button>
        <Button variant="quiet" onClick={() => setChanging(true)}>{t('business.changeRepo')}</Button>
      </div>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </section>
  );
}

/** The repo and, for a private one, a read-only key: sent once with Follow, cleared at once, never shown again. */
function FollowForm({ tokenLink, initial, onDone }: { tokenLink: string; initial: string; onDone: () => void }) {
  const t = useT();
  const client = useEngine();
  const [repo, setRepo] = useState(initial);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!repo.trim()) { setProblem(t('business.repoFirst')); return; }
    const typedKey = key;
    setKey('');
    setBusy(true);
    setProblem(null);
    try {
      await client.request('venture.build.link', typedKey ? { repo: repo.trim(), token: typedKey } : { repo: repo.trim() });
      await client.request('venture.build.sync', {});
      onDone();
    } catch (error) {
      setProblem(messageOf(error));
      setBusy(false);
    }
  }

  return (
    <form className={s.form} onSubmit={(event) => void submit(event)}>
      <Field label={t('business.repoField')} hint={t('business.repoHint')} value={repo} maxLength={160} autoComplete="off" spellCheck={false} onChange={(event) => setRepo(event.currentTarget.value)} />
      <Field label={t('business.tokenField')} hint={t('business.tokenHint')} type="password" autoComplete="off" spellCheck={false} value={key} onChange={(event) => setKey(event.currentTarget.value)} />
      <p className={s.note}><ExternalLink href={tokenLink}>{t('business.tokenLink')}</ExternalLink> {t('business.tokenLinkLine')}</p>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
      <div className={s.buttons}><Button type="submit" disabled={busy}>{t('business.follow')}</Button></div>
    </form>
  );
}
