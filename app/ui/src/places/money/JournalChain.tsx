import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import type { ReceiptVerifyView } from '../../engine/types';
import { Button } from '../../parts/Button';
import { Chip } from '../../parts/Chip';
import { Field } from '../../parts/Field';
import s from './Money.module.css';
import c from './JournalChain.module.css';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** The reasons that mean the receipt is not what was signed: changed after signing, or unsigned though signing had begun. */
const MISMATCH: ReadonlySet<ReceiptVerifyView['reason']> = new Set(['changed', 'unsigned-since']);

/**
 * Money > Journal's chain line (W4 4J22a, from 4J10's venture.journal.chain; catalogue H26): whether Chausar's record
 * of outside actions adds up, worded by the screen from the engine's codes (its state, how many entries, the first that
 * breaks it). A record that does not add up stops everything going out; the owner may accept the break they saw (a
 * second ask, sent with the digest of what they saw), and a new record starts after it. "Check a receipt", one step
 * away, checks a stored receipt against the business's signature (venture.receipt.verify) and shows the engine's line.
 */
export function JournalChain({ onAccepted }: { onAccepted: () => void }) {
  const t = useT();
  const engine = useEngine();
  const chain = useResource('venture.journal.chain', {});
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (asking) cancelRef.current?.focus(); }, [asking]);
  const view = chain.data;

  async function accept(digest: string) {
    setBusy(true);
    setProblem(null);
    try {
      await engine.request('venture.journal.acceptBreak', { digest });
      onAccepted();
    } catch (error) {
      setProblem(t('money.chain.acceptFailed', { message: messageOf(error) }));
    } finally { setBusy(false); setAsking(false); chain.reload(); }
  }

  return (
    <div className={c.box}>
      {view && (
        <div data-chain-box="">
          <p className={c.line} data-chain={view.state}>
            <Chip tone={view.state === 'ok' ? 'done' : 'fail'}>{t(view.state === 'ok' ? 'money.chain.ok' : 'money.chain.corrupt')}</Chip>
            <span aria-hidden="true">{' · '}</span>
            <span>
              {view.state === 'corrupt' ? t('money.chain.from', { seq: view.firstBadSeq ?? '' })
                : view.entries === 0 ? t('money.chain.empty') : t('money.chain.entries', { n: view.entries })}
            </span>
          </p>
          {view.state === 'corrupt' && (asking ? (
            <div className={s.ask} data-second-ask="">
              <p>{t('money.chain.acceptAsk')}</p>
              <div className={s.buttons}>
                <Button ref={cancelRef} disabled={busy} onClick={() => setAsking(false)}>{t('approval.cancel')}</Button>
                <Button variant="primary" disabled={busy} onClick={() => void accept(view.digest)}>{t('money.chain.accept')}</Button>
              </div>
            </div>
          ) : (
            <div className={s.buttons}>
              <Button onClick={() => { setProblem(null); setAsking(true); }}>{t('money.chain.acceptBreak')}</Button>
            </div>
          ))}
          {problem && <p className={s.failed} role="alert">{problem}</p>}
        </div>
      )}
      <CheckReceipt />
    </div>
  );
}

/** "Check a receipt", folded: a stored receipt's number, then whether it still matches its signature, in the engine's words. */
function CheckReceipt() {
  const t = useT();
  const engine = useEngine();
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<ReceiptVerifyView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function check(event: FormEvent) {
    event.preventDefault();
    if (!id.trim()) return;
    setBusy(true);
    setProblem(null);
    setAnswer(null);
    try { setAnswer(await engine.request('venture.receipt.verify', { id: id.trim() })); } catch (error) {
      setProblem(messageOf(error));
    } finally { setBusy(false); }
  }

  return (
    <details className={c.fold} data-fold="verify">
      <summary>{t('money.chain.check')}</summary>
      <form className={c.form} onSubmit={check}>
        <Field label={t('money.chain.receipt')} value={id} maxLength={200} onChange={(event) => setId(event.currentTarget.value)} />
        <div className={s.buttons}><Button type="submit" disabled={busy || !id.trim()}>{t('money.chain.checkButton')}</Button></div>
      </form>
      {answer && (
        <p className={c.line} data-verify={answer.reason} role="status">
          {/* Only a real mismatch reads as one (red); a receipt with no signature to check is "Not confirmed", with why. */}
          <Chip tone={answer.valid ? 'done' : MISMATCH.has(answer.reason) ? 'fail' : 'neutral'}>
            {t(answer.valid ? 'money.chain.valid' : MISMATCH.has(answer.reason) ? 'money.chain.invalid' : 'money.chain.notConfirmed')}
          </Chip>
          <span aria-hidden="true">{' · '}</span>
          <span>{answer.valid || MISMATCH.has(answer.reason) ? answer.line : t(`money.chain.reason.${answer.reason}`)}</span>
        </p>
      )}
      {problem && <p className={s.failed} role="alert">{problem}</p>}
    </details>
  );
}
