/**
 * Connections, "Web search and reading" (wave 6, 6F3; the engine's web/search.ts and web/reader.ts). The AI tool's own
 * web search comes first and needs nothing here: the engine's line says whether it is on for research work. An owner
 * who wants Chausar's own lookups to search the web adds their own Brave, Exa or Tavily key, after reading exactly what
 * goes to that provider; the key field sits outside any form, autocomplete off, cleared in a finally, and only the
 * key's last four characters come back. Each provider is labelled fixture-tested. "Read a page" shows what Chausar's
 * polite reader keeps from one public page; the page's words are untrusted, so they sit in [data-content].
 */

import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import type { SearchProviderId, WebReadView } from '../../engine/types';
import { codeWords } from './KitConnect';
import s from './Mailbox.module.css';
import k from './KitConnect.module.css';

export function WebSearch() {
  const t = useT();
  const engine = useEngine();
  const name = useId();
  const view = useResource('venture.web.search', {});
  const [opened, setOpened] = useState(false);
  const [provider, setProvider] = useState<SearchProviderId>('brave');
  const [key, setKey] = useState('');
  const [url, setUrl] = useState('');
  const [page, setPage] = useState<WebReadView | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const chosen = view.data?.providers.find((item) => item.id === provider);

  async function change(params: { provider: SearchProviderId; key: string; consentDigest: string } | { provider: null }) {
    if (busy) return;
    setKey('');
    setBusy(true);
    setProblem(null);
    try {
      await engine.request('venture.web.search', params);
      setOpened(false);
      view.reload();
    } catch (error) {
      setProblem(codeWords(error, t));
    } finally {
      setKey('');
      setBusy(false);
    }
  }

  async function read() {
    if (busy || !url.trim()) return;
    setBusy(true);
    setProblem(null);
    setPage(null);
    try {
      setPage(await engine.request('venture.web.read', { url: url.trim() }));
    } catch (error) {
      setProblem(codeWords(error, t));
    } finally {
      setBusy(false);
    }
  }

  const data = view.data;
  return (
    <div role="region" aria-label={t('web-people.search.title')} className={s.card} data-web-search="">
      {data && <p className={s.said}>{data.builtIn.line}</p>}
      {data && <p className={s.quiet}>{data.line}</p>}
      {data?.key && (
        <div className={k.item} data-search-key={data.key.provider}>
          <p className={s.said}>{t('web-people.search.saved', { name: data.key.name, hint: data.key.keyHint })}</p>
          <div className={s.actions}><Button size="sm" variant="quiet" disabled={busy} onClick={() => void change({ provider: null })}>{t('web-people.search.remove')}</Button></div>
        </div>
      )}
      {data && !opened && <div className={s.actions}><Button size="sm" onClick={() => setOpened(true)}>{t('web-people.search.add')}</Button></div>}
      {data && opened && (
        <div className={s.form} data-search-form="">
          <fieldset className={k.kinds}>
            <legend>{t('web-people.search.provider')}</legend>
            {data.providers.map((item) => (
              <label key={item.id}>
                <input type="radio" name={name} value={item.id} checked={provider === item.id} onChange={() => setProvider(item.id)} />
                {item.name}
              </label>
            ))}
          </fieldset>
          {chosen && <p className={k.small} data-search-consent="">{chosen.consent} <span>{t('web-people.fixture')}</span></p>}
          <Field
            label={t('web-people.search.key')} hint={t('web-people.search.keyHint')} type="password" autoComplete="off" spellCheck={false}
            value={key} disabled={busy} onChange={(event) => setKey(event.currentTarget.value)}
          />
          <div className={s.actions}>
            <Button variant="primary" disabled={busy || !key.trim() || !chosen} onClick={() => chosen && void change({ provider, key: key.trim(), consentDigest: chosen.consentDigest })}>{t('web-people.search.agree')}</Button>
            <Button variant="quiet" disabled={busy} onClick={() => { setKey(''); setOpened(false); }}>{t('web-people.search.cancel')}</Button>
          </div>
        </div>
      )}
      <Field label={t('web-people.read.url')} hint={t('web-people.read.urlHint')} autoComplete="off" spellCheck={false} value={url} disabled={busy} onChange={(event) => setUrl(event.currentTarget.value)} />
      <div className={s.actions}><Button size="sm" disabled={busy || !url.trim()} onClick={() => void read()}>{t('web-people.read.go')}</Button></div>
      {page && (
        <div className={k.item} data-web-page="">
          {page.title && <span className={k.name} data-content="">{page.title}</span>}
          <p className={k.small}>{page.label}. {page.line}</p>
          <p className={k.content} data-content="">{page.text}</p>
          {page.more && <p className={k.small}>{t('web-people.read.more')}</p>}
        </div>
      )}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </div>
  );
}
