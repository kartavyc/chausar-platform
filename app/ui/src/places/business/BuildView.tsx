import { messageOf } from '../../../../../platform/shared/errors.ts';
import { useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { ModelEstimate } from '../../parts/ModelEstimate';
import { saveTextFile } from '../../parts/custody';
import { EngineError, type BuildStatusView, type BuilderId, type FileBuilderId } from '../../engine/types';
import { ExternalLink, openProblem } from '../connections/external';
import { BUILDER_NAMES, handOff } from './handoff';
import { TileSection } from './shared';
import { SiteEdits } from './SiteEdits';
import { ResultLine } from '../../parts/ResultLine';
import s from './Business.module.css';
import { Fold } from '../../parts/Fold';
import { LoadingPlace } from '../../parts/Skeleton';
import { Progress } from '../../parts/Progress';

const SYNTHETIC = /synthetic recording/i;

/**
 * Website build (venture.build.*): the brief Chausar writes from the accepted plan, handed to Lovable or Replit through
 * the engine's own link (the owner presses send there), and the repo followed read-only on GitHub, its state in plain
 * words. A deployment address is shown as text, never as a link. The read-only key is sent once and never shown.
 * Under them, edits to the site itself: staged, reviewed as a diff, applied with the reviewed hash, reversible.
 * In the D look each part is a tile: the brief and the builders side by side, then GitHub, then the site edits.
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
  if (!build.data) return <LoadingPlace shape="settings" />;
  const { brief } = build.data;

  const briefTile = (
    <TileSection title={t('business.briefTitle')}>
      {!brief ? (
        <>
          <p className={s.line}>{t('business.noBrief')}</p>
          <div className={s.buttons}><Button variant="primary" disabled={busy} onClick={() => void writeBrief()}>{t('business.writeBrief')}</Button></div>
          <Progress kind="brief" active={busy} />
        </>
      ) : (
        <>
          <p className={s.line}>
            {brief.lint.ok ? t('business.briefChecks', { chars: brief.chars }) : t('business.briefNotReady', { finding: brief.lint.findings[0]?.message ?? '' })}
            {brief.estimate && <> <ModelEstimate /></>}
          </p>
          {brief.wordsBy === 'template' && <p className={s.note}>{t('business.fromTemplates')}</p>}
          {brief.wordsBy === 'mixed' && <p className={s.note}>{t('business.fromTemplatesSome')}</p>}
          <Fold summary={t('business.readBrief')} className={s.fold}>
            <pre className={s.pre}>{brief.markdown}</pre>
          </Fold>
          <div className={s.buttons}><Button size="sm" variant="quiet" disabled={busy} onClick={() => void writeBrief()}>{t('business.writeAgain')}</Button></div>
        </>
      )}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </TileSection>
  );

  return (
    <div className={s.page}>
      {brief ? (
        <div className={s.split}>
          {briefTile}
          <Builders status={build.data} ready={brief.lint.ok} onOpened={build.reload} />
        </div>
      ) : briefTile}
      <GitHub status={build.data} onChanged={build.reload} />
      <SiteEdits />
    </div>
  );
}

const FILE_BUILDERS: readonly FileBuilderId[] = ['lovable', 'replit'];

function Builders({ status, ready, onOpened }: { status: BuildStatusView; ready: boolean; onOpened: () => void }) {
  const t = useT();
  const client = useEngine();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ lines: string[]; problem: string | null } | null>(null);
  /** The note file of a brief just downloaded, offered as a second file (web and hosted). */
  const [companion, setCompanion] = useState<{ name: string; text: string } | null>(null);

  /** C5 task 35: by file. The desktop asks the engine and shows the save dialog; on the web the page asks and offers a download. */
  async function saveFile(builder: FileBuilderId) {
    setSaid(null);
    setCompanion(null);
    setBusy(true);
    const name = BUILDER_NAMES[builder];
    try {
      if (client.saveBriefFile) {
        const saved = await client.saveBriefFile(builder);
        if (saved) { setSaid({ lines: [t('business.fileSaved', { name: saved.name, companion: saved.companion, builder: name })], problem: null }); onOpened(); }
      } else {
        const plan = await client.request('venture.build.briefFile', { builder });
        const [brief, note] = plan.files;
        if (!saveTextFile(brief!.name, brief!.text, 'text/markdown;charset=utf-8')) throw new EngineError('REQUEST_FAILED', t('connections.copyFailed'));
        await client.request('venture.build.handoffOpened', { handoffId: plan.handoffId });
        setCompanion(note!);
        setSaid({ lines: [t('business.fileDownloaded', { name: brief!.name, companion: note!.name, builder: name })], problem: null });
        onOpened();
      }
    } catch (error) {
      setSaid({ lines: [], problem: openProblem(error, t) });
    } finally {
      setBusy(false);
    }
  }

  async function open(builder: BuilderId) {
    setSaid(null);
    setCompanion(null);
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

  // A file the owner cancelled never reached them, so it isn't listed.
  const shown = status.handoffs.filter((handoff) => handoff.mode !== 'file' || handoff.openedAt);

  return (
    <TileSection title={t('business.builders')}>
      {FILE_BUILDERS.map((builder) => (
        <div key={builder}>
          <p className={s.line}>{t(`business.travel.${builder}.${status.linkFits?.[builder] === false ? 'file' : 'link'}`)}</p>
          <div className={s.buttons}>
            <Button variant={builder === 'lovable' ? 'primary' : undefined} disabled={busy || !ready} onClick={() => void open(builder)}>{t(builder === 'lovable' ? 'business.openLovable' : 'business.openReplit')}</Button>
            <Button size="sm" variant="quiet" disabled={busy || !ready} onClick={() => void saveFile(builder)}>
              {t('business.saveAsFile')} <span className="sr-only">{t('business.saveFileFor', { name: BUILDER_NAMES[builder] })}</span>
            </Button>
          </div>
        </div>
      ))}
      <p className={s.note}>{t('business.directNeeds')}</p>
      <ResultLine tone={said?.problem ? 'problem' : 'done'}>{said?.problem ?? (said?.lines.length ? said.lines.map((line) => <span key={line}>{line} </span>) : null)}</ResultLine>
      {companion && <div className={s.buttons}><Button size="sm" variant="quiet" onClick={() => saveTextFile(companion.name, companion.text, 'text/markdown;charset=utf-8')}>{t('business.saveCompanion', { name: companion.name })}</Button></div>}
      {shown.length > 0 && (
        <Fold summary={t('business.handoffs')} className={s.fold}>
          <ul className={s.plain}>
            {shown.slice(0, 4).map((handoff) => (
              <li key={handoff.id}>{t(handoff.mode === 'file' ? 'business.handoffSaved' : handoff.openedAt ? 'business.handoffOpened' : 'business.handoffNotOpened', { name: BUILDER_NAMES[handoff.builder] })}</li>
            ))}
          </ul>
        </Fold>
      )}
    </TileSection>
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
      <TileSection title={t('business.followTitle')}>
        <FollowForm tokenLink={status.tokenLink} initial={follow ? `${follow.repo.owner}/${follow.repo.name}` : ''} onDone={() => { setChanging(false); onChanged(); }} />
      </TileSection>
    );
  }
  const repoName = `${follow.repo.owner}/${follow.repo.name}`;
  return (
    <TileSection title={t('business.github')}>
      {!current ? (
        <p className={s.line}>{t('business.notRead', { repo: repoName })}</p>
      ) : (
        <>
          <p className={s.strong}>
            <span>{t(`business.buildWord.${current.word}`)}</span>
            {current.syncConflictBranch && <span> {t('business.onBranch', { branch: current.syncConflictBranch })}</span>}
            <span data-code="" className={`${s.repo} mono`}>{repoName}</span>
          </p>
          {current.uiWorkflow === 'needs-fix' || current.uiWorkflow === 'missing' ? <p className={s.warn}>{t(`business.workflow.${current.uiWorkflow}`)}</p> : null}
          {current.lastCommit && (
            <p className={s.line}>{t('business.lastChange', { message: current.lastCommit.message, by: t(`business.commitBy.${current.lastCommit.by}`) })}</p>
          )}
          <p className={s.note}>{t(`business.marker.${current.briefMarker}`)} {t(`business.checks.${current.checks}`)}</p>
          {current.deployment && (
            <p className={s.line}>{t('business.address')} <span data-code="" className="mono">{current.deployment.url}</span></p>
          )}
          {/* A recording is said at rest; the other limits wait one fold away. */}
          {current.cannotSay.filter((line) => SYNTHETIC.test(line)).map((line) => <p key={line} className={s.note}>{line}</p>)}
          {current.cannotSay.some((line) => !SYNTHETIC.test(line)) && (
            <Fold summary={t('business.cannotSay')} className={s.fold}>
              {current.cannotSay.filter((line) => !SYNTHETIC.test(line)).map((line) => <p key={line} className={s.line}>{line}</p>)}
            </Fold>
          )}
        </>
      )}
      <div className={s.buttons}>
        <Button size="sm" disabled={busy} onClick={() => void check()}>{t('business.check')}</Button>
        <Button size="sm" variant="quiet" onClick={() => setChanging(true)}>{t('business.changeRepo')}</Button>
      </div>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </TileSection>
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
