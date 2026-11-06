import { useEffect, useRef } from 'react';
import { CATALOGUES, useT } from '../text';
import { useEngine, useResource } from '../engine/context';
import { Sheet } from '../parts/Sheet';
import { Button } from '../parts/Button';
import { openSheet, useRoute } from './navigation';
import type { SheetComponentProps } from './sheets';
import s from './sheets.module.css';

/**
 * C7 task 27: What's new. The notes are owner words in text/en/whats-new.json, one numbered key per line for each
 * version ("whats-new.<version>.1" and on), written with each release. A version with no lines shows nothing.
 */
export function notesFor(version: string): string[] {
  const prefix = `whats-new.${version}.`;
  return Object.keys(CATALOGUES.en).filter((key) => key.startsWith(prefix) && /^\d+$/.test(key.slice(prefix.length)))
    .sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)))
    .map((key) => CATALOGUES.en[key] as string);
}

/** The sheet: the running version's lines; Close marks the version seen, so it shows once. */
export function WhatsNewSheet({ onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const client = useEngine();
  const state = useResource('whatsNew.get', {});
  const version = state.data?.version;
  const lines = version ? notesFor(version) : [];
  const close = () => {
    if (version) void client.request('whatsNew.seen', { version }).catch(() => undefined);
    onClose();
  };
  return (
    <Sheet label={t('whats-new.label')} title={t('whats-new.title')} onClose={close} returnFocus={returnFocus}
      footer={<Button variant="primary" onClick={close}>{t('whats-new.close')}</Button>}>
      {version && lines.length === 0 && <p className={s.helpLine}>{t('whats-new.none')}</p>}
      {lines.length > 0 && <ul className={s.newsList} data-whats-new={version}>{lines.map((line) => <li key={line}>{line}</li>)}</ul>}
    </Sheet>
  );
}

/**
 * Opens What's new once after an update: when the engine says this version is not seen yet and its notes are not
 * empty, and no other sheet is open. A fresh install reads seen (the engine records it silently), so nothing opens.
 */
export function WhatsNewOnce() {
  const route = useRoute();
  const state = useResource('whatsNew.get', {});
  const opened = useRef(false);
  const data = state.data;
  useEffect(() => {
    if (opened.current || !data || data.seen || route.sheet || notesFor(data.version).length === 0) return;
    opened.current = true;
    openSheet('whats-new', data.version);
  }, [data, route.sheet]);
  return null;
}
