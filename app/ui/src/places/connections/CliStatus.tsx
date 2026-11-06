import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useT, type T } from '../../text';
import { useOwnerZone } from '../../shell/clock';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Chip, type ChipTone } from '../../parts/Chip';
import { momentOf } from '../../parts/custody';
import { Row } from '../../parts/Row';
import { useMoment } from '../../parts/when';
import { EngineError, type EngineClient, type CliStatusView, type ModelAvailability, type PlanToolLite } from '../../engine/types';
import s from './Connections.module.css';
import c from './CliStatus.module.css';
import { connectionWords } from './ConnectionWords';
import { ProviderTrouble } from '../../parts/ProviderTrouble';
import { Fold } from '../../parts/Fold';

/** The state chip: words always say it; colour only repeats it. Ready only once a real task on the tool worked. */
const STATE_TONE: Readonly<Record<ModelAvailability, ChipTone>> = { ready: 'done', unverified: 'line', 'needs-setup': 'wait', unavailable: 'idle' };

/*
 * Each finished "Check again" on this page, so Your AI reads its choices again with the same look (YourAi.tsx): the
 * engine's preset list takes its availability from the newest look at each tool. Kept in memory only.
 */
let checks = 0;
const listeners = new Set<() => void>();
export function cliChecked() {
  checks += 1;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** How many times Check again finished; a change means the engine looked again. */
export function useCliChecks(): number {
  return useSyncExternalStore(subscribe, () => checks);
}

const refreshOn = (event: { type: string }) => event.type === 'queue.changed';
const KEPT_LOOK_REREAD_MS = 3000;

/**
 * Your AI apps (W4 4H2; spec 5.3 and 8), the tile under Your AI: Claude Code and Codex as the engine found them on
 * this computer (venture.models.cli.status, 4H1), each on an inner card with its state and, while it is not ready, its
 * one fix (or the engine's line) at rest; one fold away, the engine's line of what it found and the facts behind it: whether it was found and where, the
 * version, whether its help lists every flag Chausar sends, whether it is signed in (only ever from the tool's own
 * status command) and the last real task. Disabled tools are omitted by the engine.
 * Nothing is drawn as working that the engine does not say works: a tool is Ready only once a
 * real task on it worked. Check again asks for a fresh look. Under the cards, once, the engine's line of what
 * the look ran. The hosted app uses keys only, and says so in the engine's words.
 */
export function useCliStatus() {
  const client = useEngine();
  const status = useResource('venture.models.cli.status', {}, { refreshOn });
  const plan = useResource('venture.models.plan', {}, { refreshOn });
  const checks = useCliChecks();
  useEffect(() => { if (checks > 0) { status.reload(); plan.reload(); } }, [checks]);
  const holdsKept = status.data?.clis.some(view => view.kept === true) === true;
  useEffect(() => {
    if (!holdsKept) return;
    const timer = setTimeout(() => { status.reload(); }, KEPT_LOOK_REREAD_MS);
    return () => clearTimeout(timer);
  }, [holdsKept, status.data, status.reload]);
  return { status, plan, check: () => checkAiConnections(client) };
}

/** The page's one explicit check also refreshes native status and any supported plan reading. */
export async function checkAiConnections(client: EngineClient) {
  if (client.transport === 'hosted') return;
  await client.request('venture.models.cli.status', { fresh: true });
  const plan = await client.request('venture.models.plan', {});
  if (plan.tools.some(tool => tool.canCheck)) await client.request('venture.models.plan', { fresh: true });
  cliChecked();
}

/**
 * One tool: its name and its state at rest, and while it is not ready its one fix (or, with no fix, the engine's line)
 * as the next step. One fold away: the engine's line when the fix stood in for it, and the facts behind them.
 */
export function CliTool({ view, onChosen, plan, actions, children, ran }: { view: CliStatusView; onChosen: () => void; plan?: PlanToolLite | undefined; actions?: ReactNode; children?: ReactNode; ran?: string | undefined }) {
  const t = useT();
  const moment = useMoment('short');
  const client = useEngine();
  const [choosing, setChoosing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // A2 second review: Cancel in main's own dialog is not a problem; it is said calmly.
  const [note, setNote] = useState<string | null>(null);
  // A2: a found Codex the owner has not chosen is asked about first, in the engine's words; one that cannot be used says why.
  const setup = view.setup && (view.setup.state === 'review' || view.setup.state === 'refused') ? view.setup : null;
  const atRest = setup ? setup.line : view.state === 'ready' ? null : view.fix ?? view.line;
  async function choose() {
    if (!setup?.sha256 || choosing) return;
    setChoosing(true); setProblem(null); setNote(null);
    try { await client.request('venture.ai.setup.trust', { cli: 'codex', sha256: setup.sha256 }); onChosen(); }
    catch (error) {
      if (error instanceof EngineError && error.code === 'CODEX_NOT_CHOSEN') setNote(error.message);
      else setProblem(error instanceof Error ? error.message : String(error));
    }
    finally { setChoosing(false); }
  }
  const failed = view.state === 'unverified' && view.lastTask?.outcome === 'failed';
  return (
    <Row id={`ai-${view.cli}`} title={<span data-ai-name="">{view.label}</span>}
      aside={<span data-cli-state={view.state}><Chip tone={failed ? 'wait' : STATE_TONE[view.state] ?? 'neutral'}>{t(failed ? 'connections.cli.state.lastFailed' : `connections.cli.state.${view.state}`)}</Chip></span>}
      actions={setup?.state === 'review' ? <Button size="sm" disabled={choosing} onClick={() => void choose()}>{t('first-run.ai.setup.use')}</Button> : actions}>
      {atRest !== null && (view.fix || setup
        ? <p className={c.fix} data-fix-line="">{connectionWords(t, atRest)}</p>
        : <p className={s.line} data-cli-line="">{connectionWords(t, atRest)}</p>)}
      {view.kept === true && view.checkedAt && <p className={s.line} data-cli-kept="">{t('connections.cli.lastChecked', { time: moment(view.checkedAt) })}</p>}
      {view.provider && <ProviderTrouble trouble={view.provider} className={s.line} />}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
      {note && <p className={s.said} role="status">{note}</p>}
      <Fold summary={t('connections.cli.details')} className={`${s.fold} ${c.more}`}>
        {(atRest === null || view.fix) && <p className={s.line} data-cli-line="">{connectionWords(t, view.line)}</p>}
        <p className={s.note}>{factsOf(view, t).map(([label, value]) => <span key={label}>{label}: {value}. </span>)}</p>
        {ran && <p className={s.note} data-cli-ran="">{connectionWords(t, ran)}</p>}
        {plan && <PlanMeter plan={plan} />}
      </Fold>
      {children}
    </Row>
  );
}

/**
 * C7: the plan meter for one tool, in the engine's words: each window's use and reset, then where the figures came from
 * and when. A figure never shows without its source; nothing reported says so plainly. Check now asks Codex once.
 */
function PlanMeter({ plan }: { plan: PlanToolLite }) {
  return <div className={c.plan} data-plan={plan.state}>
    {plan.windows.map(window => <p key={window.kind} className={s.line} data-plan-window={window.kind}>{window.line}</p>)}
    <p className={s.note} data-plan-source="">{plan.source}</p>
  </div>;
}

/** What was found, in the UI's words for the engine's codes. A tool that was not found has nothing more to say. */
function factsOf(view: CliStatusView, t: T): [string, ReactNode][] {
  const out: [string, ReactNode][] = [[t('connections.cli.fact.found'), t(view.found ? 'connections.cli.yes' : 'connections.cli.no')]];
  if (!view.found) return out;
  if (view.path) out.push([t('connections.cli.fact.where'), view.path]);
  out.push([t('connections.cli.fact.version'), view.version ? <span data-code="" className="mono">{view.version}</span> : t('connections.cli.notRead')]);
  out.push([t('connections.cli.fact.flags'), view.flags === 'mismatch'
    ? t('connections.cli.flags.mismatch', { flags: view.missingFlags.join(', ') })
    : t(`connections.cli.flags.${view.flags}`)]);
  out.push([t('connections.cli.fact.signedIn'), t(`connections.cli.signedIn.${view.signedIn}`)]);
  out.push([t('connections.cli.fact.lastTask'), <LastTask key="last" task={view.lastTask} />]);
  return out;
}

function LastTask({ task }: { task: CliStatusView['lastTask'] }) {
  const t = useT();
  const zone = useOwnerZone();
  if (!task) return <>{t('connections.cli.lastTask.none')}</>;
  return <>{t(`connections.cli.lastTask.${task.outcome}`)}, <span data-num="">{momentOf(task.at, zone)}</span></>;
}
