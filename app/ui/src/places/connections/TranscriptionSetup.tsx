import { useEffect, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { connectionWords } from './ConnectionWords';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Tile } from '../../parts/Tile';
import type { TranscriptionSetupView } from '../../engine/types';
import s from './Connections.module.css';

const never = () => false;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Transcription on this computer (Ink v2 wave 2, 2E2), a tile beside Your AI on the desktop: the full paths to the
 * whisper-cli program and the model file of a whisper.cpp already on this computer. The engine checks them, keeps them
 * in the vault and says the honest status in its own words (set up, not set up, or files missing). Chausar never
 * installs whisper.cpp or downloads a model. Save sends both paths; Remove clears the setup.
 */
export function TranscriptionSetup() {
  const t = useT();
  const client = useEngine();
  const setup = useResource('venture.transcription.get', {}, { refreshOn: never });
  const [view, setView] = useState<TranscriptionSetupView | null>(null);
  const [command, setCommand] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = view ?? setup.data ?? null;

  useEffect(() => {
    if (!setup.data) return;
    setCommand(setup.data.command ?? '');
    setModel(setup.data.model ?? '');
  }, [setup.data]);

  async function send(params: { command: string; model: string } | { clear: true }) {
    setBusy(true);
    setProblem(null);
    try {
      const next = await client.request('venture.transcription.set', params);
      setView(next);
      setCommand(next.command ?? '');
      setModel(next.model ?? '');
    } catch (error) {
      setProblem(t('connections.transcribe.failed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    void send({ command: command.trim(), model: model.trim() });
  }

  return (
    <Tile pad="compact">
      <form className={s.form} onSubmit={save}>
        <fieldset className={s.rule}>
          <legend className={s.title}>{t('connections.transcribe.title')}</legend>
          {shown && <p className={shown.status === 'set-up' ? s.line : s.note} role="status">{connectionWords(t, shown.line)}</p>}
          {setup.error && <p className={s.problem} role="alert">{t('connections.transcribe.loadFailed', { message: setup.error.message })}</p>}
          <p className={s.note}>{t('connections.transcribe.hint')}</p>
          <Field label={t('connections.transcribe.command')} hint={t('connections.transcribe.commandHint')} value={command} maxLength={500} autoComplete="off" spellCheck={false} onChange={(event) => setCommand(event.currentTarget.value)} />
          <Field label={t('connections.transcribe.model')} hint={t('connections.transcribe.modelHint')} value={model} maxLength={500} autoComplete="off" spellCheck={false} onChange={(event) => setModel(event.currentTarget.value)} />
          {problem && <p className={s.problem} role="alert">{problem}</p>}
          <div className={s.buttons}>
            {shown?.command && <Button size="sm" variant="quiet" disabled={busy} onClick={() => void send({ clear: true })}>{t('connections.transcribe.remove')}</Button>}
            <Button size="sm" type="submit" disabled={busy || !command.trim() || !model.trim()}>{t('connections.transcribe.save')}</Button>
          </div>
        </fieldset>
      </form>
    </Tile>
  );
}
