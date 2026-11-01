/**
 * Connections, "Your n8n or Make" (Ink v2 wave 5, 5A6; the engine's build/webhook-handoff.ts, catalogue K24): for an
 * owner who already runs n8n or Make. The webhook address is a key in itself: its field sits outside any form,
 * autocomplete off, cleared in a finally, and the engine keeps it only while the app is open (the view gives its host
 * alone). Saving is standing configuration, approved here. "Save and send the test" sends one fixed test item, shown
 * here exactly as it goes, before the address is kept. Chausar never makes or changes a workflow.
 * W6 6F4 (D33): every item is signed with a secret the owner gives beside the address (the same one their n8n or Make
 * check uses). "Make one" fills a random secret here, in the page, so the owner can copy it into that check; it is
 * cleared with the address and never comes back from the engine.
 */

import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import type { WebhookKind, WebhookView } from '../../engine/types';
import { codeWords } from './KitConnect';
import s from './Mailbox.module.css';
import k from './KitConnect.module.css';

/** build/webhook-handoff.ts TEST_ITEM, as its canonical JSON (keys in order) is sent. */
export const TEST_ITEM_TEXT = '{"from":"Chausar","line":"A test item from Chausar. You can ignore it.","test":true}';
const KINDS: readonly WebhookKind[] = ['n8n', 'make'];
const NAMES: Record<WebhookKind, string> = { n8n: 'n8n', make: 'Make' };

/** A random signing secret: 32 bytes as base64url, made in this page. */
export function makeSigningSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function Webhooks() {
  const t = useT();
  const engine = useEngine();
  const name = useId();
  const [views, setViews] = useState<Partial<Record<WebhookKind, WebhookView>>>({});
  const [opened, setOpened] = useState(false);
  const [kind, setKind] = useState<WebhookKind>('n8n');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function save(address: string | null, test: boolean, which: WebhookKind = kind) {
    if (busy) return;
    const signing = secret.trim();
    setUrl('');
    setSecret('');
    setBusy(true);
    setProblem(null);
    try {
      const view = await engine.request('venture.webhook.set', { kind: which, url: address, ...(address !== null ? { secret: signing } : {}), ...(test ? { test: true } : {}) });
      setViews((current) => ({ ...current, [which]: view }));
      setOpened(false);
    } catch (error) {
      setProblem(codeWords(error, t));
    } finally {
      setUrl('');
      setSecret('');
      setBusy(false);
    }
  }

  const set = KINDS.map((item) => views[item]).filter((view): view is WebhookView => Boolean(view));
  return (
    <div role="region" aria-label={t('kit-connect.webhook.title')} className={s.card} data-webhooks="">
      <p className={s.quiet}>{t('kit-connect.webhook.line')}</p>
      {set.map((view) => (
        <div key={view.kind} className={k.item} data-webhook={view.kind}>
          <p className={s.said}>{view.line}</p>
          {view.set && <div className={s.actions}><Button size="sm" variant="quiet" disabled={busy} onClick={() => void save(null, false, view.kind)}>{t('kit-connect.webhook.clear')}</Button></div>}
        </div>
      ))}
      {!opened && <div className={s.actions}><Button size="sm" onClick={() => setOpened(true)}>{t('kit-connect.webhook.open')}</Button></div>}
      {opened && (
        <div className={s.form} data-webhook-form="">
          <fieldset className={k.kinds}>
            <legend>{t('kit-connect.webhook.kind')}</legend>
            {KINDS.map((item) => (
              <label key={item}>
                <input type="radio" name={name} value={item} checked={kind === item} onChange={() => setKind(item)} />
                {NAMES[item]}
              </label>
            ))}
          </fieldset>
          <Field
            label={t('kit-connect.webhook.url')} hint={t('kit-connect.webhook.urlHint')} type="password" autoComplete="off" spellCheck={false}
            value={url} disabled={busy} onChange={(event) => setUrl(event.currentTarget.value)}
          />
          <Field
            label={t('kit-connect.webhook.secret')} hint={t('kit-connect.webhook.secretHint')} autoComplete="off" spellCheck={false}
            value={secret} disabled={busy} onChange={(event) => setSecret(event.currentTarget.value)}
          />
          <div className={s.actions}><Button size="sm" variant="quiet" disabled={busy} onClick={() => setSecret(makeSigningSecret())}>{t('kit-connect.webhook.makeSecret')}</Button></div>
          <p className={k.small}>{t('kit-connect.webhook.test')}</p>
          <pre className={k.code} data-test-item="">{TEST_ITEM_TEXT}</pre>
          <div className={s.actions}>
            <Button variant="primary" disabled={busy || !url.trim() || !secret.trim()} onClick={() => void save(url.trim(), false)}>{t('kit-connect.webhook.save')}</Button>
            <Button disabled={busy || !url.trim() || !secret.trim()} onClick={() => void save(url.trim(), true)}>{t('kit-connect.webhook.saveTest')}</Button>
          </div>
        </div>
      )}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </div>
  );
}
