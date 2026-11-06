import { messageOf } from '../../../../../platform/shared/errors.ts';
/**
 * W6 6I1 (D45): push-to-talk beside the chat box. A microphone button: hold it (or hold Space or Enter on it) to talk,
 * let go to stop. Before the microphone first turns on, the engine's notice shows with "Keep my recordings" (off by
 * default) and Agree, which agrees by the notice's digest. Each hold asks the engine for one recording session
 * (venture.talk.start; the desktop shell lets the microphone open only for it), records up to twenty seconds, and sends
 * the recording once (venture.talk.hear). The words come back into the chat box unsent, as if typed: the owner checks
 * them and sends them. Nothing here approves anything; a spoken "yes" is only words in the box. On the hosted tier the
 * button is locked and says why.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Icon } from '../../parts/Icon';
import { startTalkMicrophone, type TalkMicrophone } from './talk-microphone';
import s from './Talk.module.css';



export function PushToTalk({ onHeard }: { onHeard: (text: string) => void }) {
  const t = useT();
  const engine = useEngine();
  const noticeId = useId();
  const view = useResource('venture.talk.get', {}, { refreshOn: (event) => event.type === 'privacy.forgotten' });
  const [notice, setNotice] = useState(false);
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /**
   * The hold in progress, set before the first wait so a release while the session or the microphone is still opening
   * is never lost (letGo), and a second press can never start a second recording.
   */
  const mic = useRef<{ sessionId: string | null; recorder: TalkMicrophone | null; letGo: boolean } | null>(null);
  const alive = useRef(true);
  const data = view.data;
  const hosted = data ? !data.desktop : false;

  // Leaving the chat mid-hold closes the microphone at once; the recording is dropped, never sent.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const held = mic.current;
      mic.current = null;
      if (held) { held.letGo = true; void held.recorder?.stop().catch(() => null); }
    };
  }, []);

  async function begin() {
    if (!data || mic.current) return;
    setProblem(null);
    if (hosted) { setLine(data.line); return; }
    if (!data.consent.given) { setNotice(true); return; }
    const held = { sessionId: null as string | null, recorder: null as TalkMicrophone | null, letGo: false };
    mic.current = held;
    setLine(null);
    setBusy(true);
    try {
      held.sessionId = (await engine.request('venture.talk.start', {})).sessionId;
      if (held.letGo) { mic.current = null; setBusy(false); return; }
      held.recorder = await startTalkMicrophone();
      if (!alive.current || mic.current !== held) { await held.recorder.stop(); return; }
      setRecording(true);
      if (held.letGo) await finish();
    } catch (error) {
      if (mic.current === held) mic.current = null;
      if (alive.current) { setBusy(false); setProblem(t('chats.talk.failed', { message: messageOf(error) })); }
    }
  }

  async function finish() {
    const held = mic.current;
    if (!held) return;
    if (!held.recorder || !held.sessionId) { held.letGo = true; return; }
    mic.current = null;
    setRecording(false);
    try {
      const audio = await held.recorder.stop();
      if (!audio) { setLine(t('chats.talk.nothing')); return; }
      const heard = await engine.request('venture.talk.hear', { sessionId: held.sessionId, audioBase64: audio });
      if (!alive.current) return;
      onHeard(heard.text);
      setLine(heard.cost ? `${heard.line} ${t('chats.talk.cost', { figure: heard.cost.figure })}` : heard.line);
    } catch (error) {
      if (alive.current) setProblem(t('chats.talk.failed', { message: messageOf(error) }));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function agree() {
    if (!data) return;
    setBusy(true);
    setProblem(null);
    try {
      await engine.request('venture.talk.consent', { digest: data.consent.digest, keepAudio: keep });
      setNotice(false);
      view.reload();
    } catch (error) {
      setProblem(t('chats.talk.failed', { message: messageOf(error) }));
      view.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.talk} data-talk="">
      <div className={s.row}>
        <Button
          variant="quiet" size="sm" aria-label={t('chats.talk.hold')} aria-pressed={recording}
          locked={hosted} lockedReason={hosted ? data?.line : undefined}
          disabled={!data}
          onPointerDown={(event) => { event.preventDefault(); void begin(); }}
          onPointerUp={() => void finish()} onPointerLeave={() => { if (recording || mic.current) void finish(); }}
          onKeyDown={(event) => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); void begin(); } }}
          onKeyUp={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); void finish(); } }}
        >
          <Icon name="mic" size={16} />
        </Button>
        {recording && <p className={s.line} role="status">{t('chats.talk.listening')}</p>}
      </div>
      {notice && data && (
        <section className={s.notice} aria-labelledby={noticeId}>
          <h3 id={noticeId} className={s.noticeTitle}>{t('chats.talk.noticeTitle')}</h3>
          <p className={s.noticeText}>{data.consent.text}</p>
          <label className={s.check}>
            <input type="checkbox" checked={keep} disabled={busy} onChange={(event) => setKeep(event.target.checked)} />
            {t('chats.talk.keep')}
          </label>
          <div className={s.actions}>
            <Button disabled={busy} onClick={() => setNotice(false)}>{t('chats.talk.notNow')}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void agree()}>{t('chats.talk.agree')}</Button>
          </div>
        </section>
      )}
      {line && <p className={s.line} role="status">{line}</p>}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </div>
  );
}
