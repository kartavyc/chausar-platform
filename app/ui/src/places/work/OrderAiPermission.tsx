import { useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { refusalWords } from '../../parts/custody';
import { allowClientAi } from '../clients/AiConsent';
import s from './Work.module.css';

const never = () => false;
/** The preset the engine names when no AI is connected: templates read nothing, so no permission is needed to start. */
const TEMPLATES = 'built-in-templates';

/** Whether an AI would read a client's data when their work starts: one is connected for the main work. */
export function useAiServes(): boolean {
  const models = useResource('venture.models.status', {}, { refreshOn: never });
  const main = models.data?.tiers.main;
  return !!main && main.presetId !== TEMPLATES;
}

/**
 * The client's AI permission, said where an order is made (found on Windows, 16 Nov 2026: New order said nothing and
 * Start then failed with "Allow this client's data to reach your AI before starting their work."). For a client not
 * yet allowed, while an AI is connected: one line that their work starts only after it, the permission's own words as
 * the engine gives them (venture.client.aiConsent.get), and Allow, which records exactly those words on that press
 * through the one call the client's sheet uses (allowClientAi). Reading this grants nothing and nothing is assumed:
 * the owner may add the order without it, and Work's Start still offers Allow and start. Once allowed here it says
 * so; for a client allowed before, or with no AI connected, it shows nothing.
 */
export function OrderAiPermission({ clientId, name }: { clientId: string; name: string }) {
  const t = useT();
  const engine = useEngine();
  const serves = useAiServes();
  const consent = useResource('venture.client.aiConsent.get', { clientId }, { refreshOn: never });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [allowedHere, setAllowedHere] = useState<string | null>(null);
  const view = consent.data?.clientId === clientId ? consent.data : undefined;
  if (!serves || !view) return null;
  if (view.status === 'agreed') return allowedHere === clientId ? <p className={s.hint} role="status" data-order-ai="allowed">{t('work.form.aiAllowed', { name })}</p> : null;

  async function allow() {
    if (busy || !view) return;
    setBusy(true);
    setProblem(null);
    try {
      await allowClientAi(engine, clientId, view);
      setAllowedHere(clientId);
    } catch (error) {
      // The permission's words changed under the press: nothing was recorded, and the words are read again.
      setProblem(refusalWords(error, t));
    } finally {
      setBusy(false);
      consent.reload();
    }
  }

  return (
    <div className={s.field} data-order-ai="needed">
      <p className={s.hint} role="status">{t('work.form.aiNeeded', { name })}</p>
      <p className={s.hint} data-content="">{view.disclosure}</p>
      <div><Button size="sm" disabled={busy} aria-busy={busy || undefined} onClick={() => void allow()}>{t('clients.ai.allow')}</Button></div>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </div>
  );
}
