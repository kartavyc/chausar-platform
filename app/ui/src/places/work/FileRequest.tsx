import { useId, useMemo, useState } from 'react';
import { useLanguage, useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Tile, TileHead } from '../../parts/Tile';
import type { FileRequestView } from '../../engine/types';
import s from './Work.module.css';
import f from './FileRequest.module.css';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * "A file from your client" on a Work order (W4 4J21, from 4J7's venture.share.request, catalogue K9): one press makes
 * a single-use upload link that works for 15 minutes. On the hosted app with a public address the engine sends the link,
 * shown as text with Copy and the time it ends, and its own line that the file never passes through the model; anywhere
 * else it sends no address and says why, in its words. Off the hosted app nothing is made: Ask is locked and the line says
 * why (the engine's own sentence), so no unusable request is stored. A temporary business is refused in the engine's words.
 */
export function FileRequest({ orderId }: { orderId: string }) {
  const t = useT();
  const language = useLanguage();
  const client = useEngine();
  const headingId = useId();
  const reasonId = useId();
  // Only the hosted app with a public address serves the link (4J7): anywhere else nothing is made, and Ask says why.
  const served = client.transport === 'hosted';
  const [made, setMade] = useState<FileRequestView | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const time = useMemo(() => new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }), [language]);

  async function ask() {
    setBusy(true);
    setProblem(null);
    setCopied(false);
    try { setMade(await client.request('venture.share.request', { orderId })); }
    catch (error) { setProblem(messageOf(error)); }
    finally { setBusy(false); }
  }

  function copy(url: string) {
    try { void navigator.clipboard?.writeText(url).then(() => setCopied(true), () => setCopied(false)); } catch { setCopied(false); }
  }

  return (
    <Tile as="section" labelledBy={headingId} className={f.tile}>
      <TileHead id={headingId} title={t('work.request.title')} />
      <p className={s.note}>{t('work.request.line')}</p>
      <div className={s.act}>
        <Button disabled={busy} aria-busy={busy || undefined} locked={!served} lockedNoteId={served ? undefined : reasonId} onClick={() => void ask()}>{busy ? t('work.request.making') : t('work.request.ask')}</Button>
      </div>
      {!served && <p id={reasonId} className={s.quiet} data-request-reason="">{t('work.request.notServed')}</p>}
      {made && (made.url ? (
        <div className={s.links} data-request="">
          <p className={s.link}>
            <span className={`${s.url} mono`}>{made.url}</span>
            <span className={s.until}>{t('work.request.until', { time: time.format(new Date(made.expiresAt)) })}</span>
            <span className={s.act}><Button variant="quiet" onClick={() => copy(made.url!)}>{copied ? t('work.share.copied') : t('work.share.copy')}</Button></span>
          </p>
          <p className={s.note}>{made.line}</p>
        </div>
      ) : (
        <p className={s.quiet} role="status" data-request-reason="">{made.reason ?? made.line}</p>
      ))}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </Tile>
  );
}
