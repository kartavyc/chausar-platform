import { useEffect, useId, useState, type FormEvent } from 'react';
import { useT } from '../text';
import { useEngine, useResource } from '../engine/context';
import type { HostedTrialView } from '../engine/types';
import { Button } from '../parts/Button';
import { Field } from '../parts/Field';
import { Icon } from '../parts/Icon';
import s from './TrialBanner.module.css';

const never = () => false;

/**
 * Asks the hosted server to email the link that keeps a temporary business on an account (4J23's
 * POST /api/hosted/trial/claim, an account route of the server, not an engine method): the session cookie goes with it
 * from this page, and the email travels only in the body. Answers whether the server delivers email at all, or throws
 * the server's own words.
 */
export async function claimTrial(email: string, send: typeof fetch = fetch): Promise<{ delivers: boolean }> {
  const response = await send('/api/hosted/trial/claim', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  const body = (await response.json().catch(() => ({}))) as { delivers?: unknown; error?: { message?: unknown } };
  if (!response.ok) throw new Error(typeof body.error?.message === 'string' ? body.error.message : `HTTP ${response.status}`);
  return { delivers: body.delivers === true };
}

/**
 * The hosted trial banner (W4 4J21, from 4J23): while the open business was started on the hosted app without an
 * account, a quiet line above every place says the server's own sentence, "This business is temporary until you add
 * your email.", and in its last day the server's warning too. Add email asks for the address and sends the link that
 * keeps the business (claimTrial). Nothing shows on this computer, or once the business is kept on an account.
 */
export function TrialBanner() {
  const t = useT();
  const client = useEngine();
  const labelId = useId();
  // The hosted session's `me` first (client.hostedMe, read with the session); workspace.status's hosted view otherwise.
  const [me, setMe] = useState<HostedTrialView | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    client.hostedMe?.().then((answer) => { if (live && answer) setMe(answer.trial); }, () => {});
    return () => { live = false; };
  }, [client]);
  const status = useResource('workspace.status', {}, { refreshOn: never, skip: me !== undefined });
  const trial = me !== undefined ? me : status.data?.hosted?.trial;
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (!trial) return null;

  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const address = email.trim();
    if (!address) { setProblem(t('trial.emailFirst')); return; }
    setBusy(true);
    setProblem(null);
    try {
      if (client.transport !== 'hosted') throw new Error(t('trial.notHere'));
      const answer = await claimTrial(address);
      setSent(t(answer.delivers ? 'trial.sent' : 'trial.notDelivered'));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={s.banner} aria-labelledby={labelId} data-trial="">
      <h2 id={labelId} className="sr-only">{t('trial.label')}</h2>
      <div className={s.head}>
        <Icon name="clock" size={16} className={s.icon} />
        <div className={s.words}>
          <p className={s.line}>{trial.line}</p>
          {trial.warning && <p className={s.warning} data-trial-warning="">{trial.warning}</p>}
        </div>
        {!open && !sent && <Button size="sm" onClick={() => setOpen(true)}>{t('trial.addEmail')}</Button>}
      </div>
      {sent ? <p className={s.sent} role="status">{sent}</p> : open && (
        <form className={s.form} onSubmit={send} noValidate>
          <Field label={t('trial.email')} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
          <Button variant="primary" type="submit" disabled={busy} aria-busy={busy || undefined}>{t('trial.send')}</Button>
        </form>
      )}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </section>
  );
}
