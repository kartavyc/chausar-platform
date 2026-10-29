import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useLanguage, useT, type T } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Inner } from '../../parts/Card';
import { Chip, type ChipTone } from '../../parts/Chip';
import { momentOf } from '../../parts/custody';
import { Icon } from '../../parts/Icon';
import { Tile, TileHead } from '../../parts/Tile';
import { EngineError, type CliStatusView, type ModelAvailability } from '../../engine/types';
import s from './Connections.module.css';
import c from './CliStatus.module.css';
import { connectionWords } from './ConnectionWords';

/** The state chip: words always say it; colour only repeats it. Ready only once a real task on the tool worked. */
const STATE_TONE: Readonly<Record<ModelAvailability, ChipTone>> = { ready: 'done', unverified: 'line', 'needs-setup': 'wait', unavailable: 'idle' };

/*
 * Each finished "Check again" on this page, so Your AI reads its choices again with the same look (YourAi.tsx): the
 * engine's preset list takes its availability from the newest look at each tool. Kept in memory only.
 */
let checks = 0;
const listeners = new Set<() => void>();
function checked() {
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

/**
 * Your AI apps (W4 4H2; spec 5.3 and 8), the tile under Your AI: Claude Code and Codex as the engine found them on
 * this computer (venture.models.cli.status, 4H1), each on an inner card with its state and, while it is not ready, its
 * one fix (or the engine's line) at rest; one fold away, the engine's line of what it found and the facts behind it: whether it was found and where, the
 * version, whether its help lists every flag Chausar sends, whether it is signed in (only ever from the tool's own
 * status command), Anthropic's terms for Claude Code (while they are pending, Claude Code is only located, never run)
 * and the last real task. Nothing is drawn as working that the engine does not say works: a tool is Ready only once a
 * real task on it worked. Check again asks for a fresh look. Under the cards, once, the engine's line of what
 * the look ran. The hosted app uses keys only, and says so in the engine's words.
 */
export function CliStatus() {
  const t = useT();
  const client = useEngine();
  const headingId = useId();
  const status = useResource('venture.models.cli.status', {}, { refreshOn });
  const [fresh, setFresh] = useState<typeof status.data>(undefined);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; problem: boolean } | null>(null);
  // A new read (a business switch) replaces what an earlier Check again found.
  useEffect(() => { setFresh(undefined); }, [status.data]);

  const data = fresh ?? status.data;
  const keysOnly = status.error?.code === 'TIER_UNAVAILABLE';

  async function checkAgain() {
    if (busy) return;
    setBusy(true);
    setSaid(null);
    try {
      setFresh(await client.request('venture.models.cli.status', { fresh: true }));
      setSaid({ text: t('connections.cli.checked'), problem: false });
      checked();
    } catch (error) {
      setSaid({ text: t('connections.cli.failed', { message: error instanceof EngineError || error instanceof Error ? error.message : String(error) }), problem: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Tile as="section" labelledBy={headingId} className={c.tile}>
      <TileHead
        id={headingId}
        title={t('connections.cli.title')}
        end={data ? <Button size="sm" disabled={busy} aria-busy={busy || undefined} onClick={() => void checkAgain()}>{t('connections.cli.check')}</Button> : undefined}
      />
      {keysOnly && <p className={s.note}>{status.error!.message}</p>}
      {status.error && !keysOnly && !data && <p className={s.problem} role="alert">{t('connections.cli.failed', { message: status.error.message })}</p>}
      {!data && !status.error && <p className={s.note}>{t('connections.cli.loading')}</p>}
      {data && (
        <>
          <ul className={c.tools}>
            {data.clis.map((view) => <Tool key={view.cli} view={view} />)}
          </ul>
          {/* What this look ran, once for the tile, in the engine's words (it names only the tools it started). */}
          <p className={`${s.note} ${c.how}`} data-cli-ran="">{connectionWords(t, data.line)}</p>
        </>
      )}
      {said && <p className={said.problem ? s.problem : s.said} role="status">{said.text}</p>}
    </Tile>
  );
}

/**
 * One tool: its name and its state at rest, and while it is not ready its one fix (or, with no fix, the engine's line)
 * as the next step. One fold away: the engine's line when the fix stood in for it, and the facts behind them.
 */
function Tool({ view }: { view: CliStatusView }) {
  const t = useT();
  const nameId = useId();
  const atRest = view.state === 'ready' ? null : view.fix ?? view.line;
  const failed = view.state === 'unverified' && view.lastTask?.outcome === 'failed';
  return (
    <Inner as="li" labelledBy={nameId} className={c.tool}>
      <div className={c.toolHead}>
        <span className={s.jobIcon} aria-hidden="true"><Icon name="bot" size={16} /></span>
        <h3 id={nameId} className={c.name}>{view.label}</h3>
        <span className={c.chip} data-cli-state={view.state}>
          {/* A last task that failed is said as that, never as "Not yet tried". */}
          {failed
            ? <Chip tone="wait">{t('connections.cli.state.lastFailed')}</Chip>
            : <Chip tone={STATE_TONE[view.state] ?? 'neutral'}>{t(`connections.cli.state.${view.state}`)}</Chip>}
        </span>
      </div>
      {atRest !== null && (view.fix
        ? <p className={c.fix} data-fix-line="">{connectionWords(t, atRest)}</p>
        : <p className={s.line} data-cli-line="">{connectionWords(t, atRest)}</p>)}
      <details className={`${s.fold} ${c.more}`}>
        <summary>{t('connections.cli.details')}</summary>
        {(atRest === null || view.fix) && <p className={s.line} data-cli-line="">{connectionWords(t, view.line)}</p>}
        <dl className={c.facts}>
          {factsOf(view, t).map(([label, value]) => (
            <div key={label} className={c.fact}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </Inner>
  );
}

/** What was found, in the UI's words for the engine's codes. A tool that was not found has nothing more to say. */
function factsOf(view: CliStatusView, t: T): [string, ReactNode][] {
  const out: [string, ReactNode][] = [[t('connections.cli.fact.found'), t(view.found ? 'connections.cli.yes' : 'connections.cli.no')]];
  if (!view.found) return out;
  if (view.path) out.push([t('connections.cli.fact.where'), view.path]);
  out.push([t('connections.cli.fact.version'), view.version ? <span className="mono">{view.version}</span> : t('connections.cli.notRead')]);
  out.push([t('connections.cli.fact.flags'), view.flags === 'mismatch'
    ? t('connections.cli.flags.mismatch', { flags: view.missingFlags.join(', ') })
    : t(`connections.cli.flags.${view.flags}`)]);
  out.push([t('connections.cli.fact.signedIn'), t(`connections.cli.signedIn.${view.signedIn}`)]);
  if (view.terms !== 'not-needed') out.push([t('connections.cli.fact.terms'), t(`connections.cli.terms.${view.terms}`)]);
  out.push([t('connections.cli.fact.lastTask'), <LastTask key="last" task={view.lastTask} />]);
  return out;
}

function LastTask({ task }: { task: CliStatusView['lastTask'] }) {
  const t = useT();
  const language = useLanguage();
  if (!task) return <>{t('connections.cli.lastTask.none')}</>;
  return <>{t(`connections.cli.lastTask.${task.outcome}`)}, <span className="mono">{momentOf(task.at, language)}</span></>;
}
