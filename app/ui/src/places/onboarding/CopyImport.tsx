import { messageOf } from '../../../../../platform/shared/errors.ts';
import { useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import type { CopyImportInput } from '../../engine/types';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { codeOf, refusalWords } from '../../parts/custody';
import { Way, useNewPassphrase } from './WelcomeWays';
import s from './Onboarding.module.css';



/**
 * C5 task 21: open an exported copy. The desktop shows the file dialog and hands back a token and the file's name; the window
 * never holds a path. The engine says what it needs next: the copy's passphrase or recovery code, a yes to restoring a
 * business already here, or a new passphrase when this computer can't keep the key. Refusals are its own words. A secret is
 * cleared from its field once sent.
 */
export function CopyImport({ onOpened }: { onOpened: () => void }) {
  const t = useT();
  const client = useEngine();
  const pair = useNewPassphrase();
  const [picked, setPicked] = useState<{ token: string; name: string } | null>(null);
  const [ask, setAsk] = useState<null | 'passphrase' | 'code'>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [offer, setOffer] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function send(copy: { token: string; name: string }, how: { ask: typeof ask; restore: boolean; secret: string }) {
    const payload: CopyImportInput = { token: copy.token };
    if (how.ask === 'passphrase') payload.passphrase = how.secret;
    if (how.ask === 'code') {
      payload.recoveryCode = how.secret.trim();
      const bad = pair.problem();
      if (bad) { setProblem(t(bad)); return; }
      if (pair.wanted) payload.passphrase = pair.value;
    }
    if (how.restore) payload.restore = true;
    setSecret('');
    pair.clear();
    setBusy(true);
    setProblem(null);
    setOffer(null);
    try {
      await client.importCopy!(payload);
      onOpened();
    } catch (error) {
      const code = codeOf(error);
      if (code === 'PASSPHRASE_REQUIRED') { setAsk((now) => now ?? 'passphrase'); setReason(messageOf(error)); }
      else if (code === 'IMPORT_ALREADY_HERE') setOffer(messageOf(error));
      else if (code === 'DEVICE_KEYS_UNAVAILABLE' && how.ask === 'code' && !pair.wanted) pair.show(messageOf(error));
      else setProblem(refusalWords(error, t));
    }
    setBusy(false);
  }

  async function choose() {
    setProblem(null);
    setOffer(null);
    let got: { token: string; name: string } | null;
    try { got = await client.pickCopy!(); } catch (error) { setProblem(refusalWords(error, t)); return; }
    if (!got) return;
    setPicked(got);
    setAsk(null);
    setReason(null);
    setRestoring(false);
    await send(got, { ask: null, restore: false, secret: '' });
  }

  function restore() {
    if (!picked) return;
    setRestoring(true);
    void send(picked, { ask, restore: true, secret });
  }

  return (
    <div className={s.ask}>
      <div className={s.file}>
        <Button disabled={busy} onClick={() => void choose()}>{t('onboarding.copy.choose')}</Button>
        {picked && <span className={s.note} data-content="">{picked.name}</span>}
      </div>
      {offer && (
        <>
          <p className={s.note} data-engine-line="">{offer}</p>
          <div className={s.actions}><Button variant="primary" disabled={busy} onClick={restore}>{t('onboarding.copy.restore')}</Button></div>
        </>
      )}
      {ask && picked && (
        <>
          {reason && <p className={s.note} data-engine-line="">{reason}</p>}
          <Field
            label={t(ask === 'passphrase' ? 'onboarding.copy.passphrase' : 'onboarding.recover.code')} type="password" spellCheck={false}
            autoComplete="off" value={secret} onChange={(event) => setSecret(event.currentTarget.value)}
          />
          {pair.node}
          <div className={s.actions}>
            <Button variant="primary" disabled={busy || !secret} onClick={() => void send(picked, { ask, restore: restoring, secret })}>{t('onboarding.copy.go')}</Button>
            <Button variant="quiet" disabled={busy} onClick={() => { setAsk(ask === 'passphrase' ? 'code' : 'passphrase'); setSecret(''); setProblem(null); }}>{t(ask === 'passphrase' ? 'onboarding.copy.useCode' : 'onboarding.copy.usePassphrase')}</Button>
          </div>
        </>
      )}
      {problem && <p className={s.problem} role="alert" data-engine-line="">{problem}</p>}
    </div>
  );
}

/** Open an exported copy, as a way in from Welcome back. */
export function OpenCopy({ onOpened, onBack }: { onOpened: () => void; onBack: () => void }) {
  const t = useT();
  return (
    <Way title={t('onboarding.copy.title')} lead={t('onboarding.copy.lead')} onBack={onBack}>
      <CopyImport onOpened={onOpened} />
    </Way>
  );
}
