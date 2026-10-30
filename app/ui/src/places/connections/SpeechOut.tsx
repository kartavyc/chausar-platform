/**
 * Connections, "Speech from text" (Ink v2 wave 5, 5A6; the engine's build/speech-out.ts): text to speech on the
 * owner's own provider key, after a quote, with a stock voice and its licence or a voice whose speaker's consent is
 * recorded. Each provider shows the engine's honest label: every one needs a key Chausar has no place to take in this
 * build, so each is planned, with what it waits on and what to do meanwhile. Nothing here makes any audio.
 */

import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { ConnectorLabel } from '../../parts/ConnectorLabel';
import s from './Mailbox.module.css';
import k from './KitConnect.module.css';

export function SpeechOut() {
  const t = useT();
  const view = useResource('venture.speechOut.providers', {});
  return (
    <div role="region" aria-label={t('kit-connect.speech.title')} className={s.card} data-speech-out="">
      <p className={s.quiet}>{t('kit-connect.speech.line')}</p>
      {view.data && <p className={s.said}>{view.data.line}</p>}
      {view.data && (
        <ul className={k.list}>
          {view.data.providers.map((provider) => (
            <li key={provider.id} className={k.item} data-speech-provider={provider.id}>
              <div className={k.itemHead}>
                <span className={k.name}>{provider.name}</span>
                <ConnectorLabel label={provider.label === 'write' ? 'write' : 'planned'} />
              </div>
              <p className={k.small}>{provider.languages.join(', ')}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
