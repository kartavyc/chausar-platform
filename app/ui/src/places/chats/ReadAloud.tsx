import { messageOf } from '../../../../../platform/shared/errors.ts';
/**
 * W6 6I1 (D45): Read aloud on one answer from Chausar. The engine builds the words to speak from the stored answer, only
 * what code checked (each figure by its receipt, never a number the AI wrote), and quotes the speech call first
 * (venture.talk.say). The owner taps the quote to make the audio once on their own speech key; it is played here and
 * not kept, and the engine's line says it is an AI voice. Without a key the engine's line says to read on screen.
 */

import { useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Icon } from '../../parts/Icon';
import type { TalkSaid } from '../../engine/types';
import s from './Talk.module.css';



export function ReadAloud({ threadId, messageId }: { threadId: string; messageId: string }) {
  const t = useT();
  const engine = useEngine();
  const [said, setSaid] = useState<TalkSaid | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function ask() {
    setBusy(true);
    setProblem(null);
    try { setSaid(await engine.request('venture.talk.say', { threadId, messageId })); }
    catch (error) { setProblem(t('chats.read.failed', { message: messageOf(error) })); }
    finally { setBusy(false); }
  }

  async function play() {
    if (!said?.quote) return;
    setBusy(true);
    setProblem(null);
    try {
      const made = await engine.request('venture.talk.say', { threadId, messageId, quoted: said.quote.textDigest, approvedRateDigest: said.quote.rateDigest });
      setSaid({ ...made, quote: null });
      if (made.audioBase64) void new Audio(`data:audio/mpeg;base64,${made.audioBase64}`).play().catch(() => undefined);
    } catch (error) {
      setProblem(t('chats.read.failed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.read} data-read-aloud="">
      <Button variant="quiet" size="sm" aria-label={t('chats.read.label')} disabled={busy} onClick={() => void ask()}>
        <Icon name="play" size={14} />
      </Button>
      {said?.quote && <Button size="sm" disabled={busy} onClick={() => void play()}>{t('chats.read.quote', { figure: said.quote.figure })}</Button>}
      {said && <p className={s.line} role="status">{said.line}</p>}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </div>
  );
}
