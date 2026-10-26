import { useEffect, useId, useMemo, useState } from 'react';
import { useLanguage, useT } from '../../text';
import { useEngine } from '../../engine/context';
import { useClock } from '../../shell/clock';
import { openSheet } from '../../shell/navigation';
import { Button } from '../../parts/Button';
import { StatusMark, type StatusTone } from '../../parts/Row';
import { Tile, TileHead } from '../../parts/Tile';
import type { ConnectorCheckRow, ConnectorChecksView } from '../../engine/types';
import s from './Connections.module.css';
import c from './ChecksTile.module.css';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const TONE: Readonly<Record<ConnectorCheckRow['outcome'], StatusTone>> = { answered: 'ok', failed: 'fail', skipped: 'question' };

/** A day the engine sent ("2027-01-13") as "13 Jan 2027" in the reader's language. */
function dayOf(day: string, language: string): string {
  const at = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(at.getTime()) ? day : new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(at);
}

/** Where a connection is set up again: Your AI for a key or a tool, the bank sheet, Website build for GitHub. */
function reconnect(row: ConnectorCheckRow): { href: string } | { sheet: [string, string] } {
  if (row.connectorId.startsWith('model:') || row.connectorId.startsWith('cli:')) return { href: '#/connections/ai' };
  if (row.connectorId === 'bank-account') return { sheet: ['bank', 'bank-account'] };
  if (row.connectorId === 'github') return { href: '#/business/build' };
  return { href: '#/connections' };
}

/**
 * "Check connections" (W4 4J21, from 4J7's venture.connectors.check, catalogue K7): one press makes one cheap real
 * read of each connection this business has, and lists what each found in the engine's words: answered, failed or
 * skipped, with its fix, "Connected as" where the provider says it, and the day its access ends. Ready, Warnings and
 * Blocking are the engine's counts. A connection whose access has ended offers Reconnect, to where it is set up again.
 * Nothing runs until the owner presses; a check is a real read, never a guess.
 */
export function ChecksTile() {
  const t = useT();
  const language = useLanguage();
  const client = useEngine();
  // Today on this computer's calendar (not the UTC day), as 'YYYY-MM-DD', to compare with the day access ends.
  const now = useClock()();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const headingId = useId();
  const listId = useId();
  const [view, setView] = useState<ConnectorChecksView | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // The newest check, read when the tile opens ({ last: true }: no new read, nothing stored), so it is not empty.
  useEffect(() => {
    let live = true;
    client.request('venture.connectors.check', { last: true }).then((last) => { if (live && last) setView((now) => now ?? last); }, () => {});
    return () => { live = false; };
  }, [client]);
  const when = useMemo(() => {
    const day = new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short' });
    const time = new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    return (iso: string) => `${day.format(new Date(iso))}, ${time.format(new Date(iso))}`;
  }, [language]);

  async function check() {
    setBusy(true);
    setProblem(null);
    try { setView(await client.request('venture.connectors.check', {})); }
    catch (error) { setProblem(messageOf(error)); }
    finally { setBusy(false); }
  }

  const health = view?.health;
  return (
    <Tile as="section" labelledBy={headingId} className={c.tile}>
      <TileHead id={headingId} title={t('connections.checks.title')} />
      <p className={s.note}>{t('connections.checks.line')}</p>
      <div className={c.actions}>
        <Button disabled={busy} aria-busy={busy || undefined} onClick={() => void check()}>{busy ? t('connections.checks.checking') : t('connections.checks.run')}</Button>
      </div>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
      {view && <p className={s.note} data-checked-at="">{t('connections.checks.at', { when: when(view.at) })}</p>}
      {view && health && (
        <>
          {view.rows.length === 0 ? <p className={s.note} role="status">{t('connections.checks.none')}</p> : (
            <>
              <p className={c.health} data-health="">
                {t('connections.checks.ready', { count: String(health.ready) })} · {t('connections.checks.warnings', { count: String(health.warnings) })} · {t('connections.checks.blocking', { count: String(health.blocking) })}
              </p>
              <p id={listId} className="sr-only">{t('connections.checks.found')}</p>
              <ul className={c.rows} aria-labelledby={listId}>
                {view.rows.map((row, index) => {
                  // Access lasts through its last day: it has ended only once that day is over.
                  const ended = row.expiresOn !== null && row.expiresOn < today;
                  const again = reconnect(row);
                  return (
                    <li key={`${row.connectorId}-${index}`} className={c.row} data-check={row.connectorId}>
                      <span className={c.mark}><StatusMark tone={TONE[row.outcome]} /></span>
                      <div className={c.body}>
                        <p className={c.head}>
                          <span className={c.name} data-check-name="">{row.name}</span>
                          <span className={c.outcome} data-outcome={row.outcome}>{t(`connections.checks.outcome.${row.outcome}`)}</span>
                        </p>
                        <p className={c.line}>{row.line}</p>
                        {row.fix && <p className={c.fix}>{row.fix}</p>}
                        {row.expiresOn && (
                          <p className={c.ends} data-ended={ended ? '' : undefined}>
                            {t(ended ? 'connections.checks.ended' : 'connections.checks.ends', { day: dayOf(row.expiresOn, language) })}
                          </p>
                        )}
                      </div>
                      {ended && (
                        <span className={c.again}>
                          {'sheet' in again
                            ? <Button size="sm" aria-label={t('connections.checks.reconnectNamed', { name: row.name })} onClick={(event) => openSheet(again.sheet[0], again.sheet[1], event.currentTarget)}>{t('connections.checks.reconnect')}</Button>
                            : <a className={s.link} href={again.href} aria-label={t('connections.checks.reconnectNamed', { name: row.name })}>{t('connections.checks.reconnect')}</a>}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}
    </Tile>
  );
}
