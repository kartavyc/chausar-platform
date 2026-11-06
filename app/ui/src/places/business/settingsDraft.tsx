import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLanguage, useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import b from './Business.module.css';

/** How long typing rests before the unsent edits are kept. */
const REST_MS = 700;

export interface DraftOffer<V> { values: V; at: string }

/** A draft the owner turned down: kept as no values at all, which no form offers back. */
const isDeclined = (values: unknown) => values !== null && typeof values === 'object' && !Array.isArray(values) && Object.keys(values).length === 0;

/**
 * Autosave for a settings form (W4 4J21, from 4J2's core/settings-drafts.ts; W3's O22). While the owner edits, the
 * form's unsent values are kept in the vault with venture.settings.draft once typing rests, and the engine answers
 * "Saved"; when it refuses, its own line is said instead. Nothing is kept in browser storage. When the form opens, a
 * draft left behind (the window closed before Save) is offered back from venture.settings.drafts; the engine clears a
 * draft once the form's real setting saved exactly its values, so `values` must be exactly what that method takes.
 * "Not now" declines it on purpose: the engine has no way to drop a draft, so the form keeps an empty one in its place,
 * which no form offers back, and the next edit replaces it.
 */
export function useSettingsDraft<V>(form: string, values: V, dirty: boolean): {
  saved: boolean; refused: string | null; offer: DraftOffer<V> | null; decline: () => void; taken: () => void;
} {
  const client = useEngine();
  const [saved, setSaved] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [offer, setOffer] = useState<DraftOffer<V> | null>(null);
  const key = JSON.stringify(values);
  const kept = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    client.request('venture.settings.drafts', {}).then(
      (answer) => {
        const draft = answer.drafts.find((item) => item.form === form);
        if (live && draft && !isDeclined(draft.values)) setOffer({ values: draft.values as V, at: draft.at });
      },
      () => { /* no draft to offer: the form works as it is */ },
    );
    return () => { live = false; };
  }, [client, form]);

  useEffect(() => {
    setSaved(false);
    if (!dirty || kept.current === key) return;
    const timer = setTimeout(() => {
      client.request('venture.settings.draft', { form, values: JSON.parse(key) as unknown }).then(
        () => { kept.current = key; setSaved(true); setRefused(null); },
        (error: unknown) => { setSaved(false); setRefused(error instanceof Error ? error.message : String(error)); },
      );
    }, REST_MS);
    return () => clearTimeout(timer);
  }, [client, form, key, dirty]);

  function decline() {
    setOffer(null);
    kept.current = '{}';
    client.request('venture.settings.draft', { form, values: {} }).then(() => {}, (error: unknown) => setRefused(error instanceof Error ? error.message : String(error)));
  }

  return { saved, refused, offer, decline, taken: () => setOffer(null) };
}

/** "Recover unsaved changes from 18:42?" with Recover and Not now, for a draft a settings form left behind. */
export function DraftRecover<V>({ offer, onRecover, onDecline }: { offer: DraftOffer<V>; onRecover: (values: V) => void; onDecline: () => void }) {
  const t = useT();
  const language = useLanguage();
  const id = useId();
  const time = useMemo(() => new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }), [language]);
  return (
    <div className={b.draftOffer} role="group" aria-labelledby={id} data-draft-offer="">
      <p id={id} className={b.line}>{t('business.owner.recover', { time: time.format(new Date(offer.at)) })}</p>
      <span className={b.buttons}>
        <Button size="sm" onClick={() => onRecover(offer.values)}>{t('business.owner.recoverGo')}</Button>
        <Button size="sm" variant="quiet" onClick={onDecline}>{t('business.owner.recoverNo')}</Button>
      </span>
    </div>
  );
}

/** The autosave's word beside a form's Save: "Saved", or the engine's own line when it would not keep the draft. */
export function DraftWord({ saved, refused, shown }: { saved: boolean; refused: string | null; shown: boolean }) {
  const t = useT();
  if (refused) return <span className={b.problem} role="status" data-draft-refused="">{refused}</span>;
  return saved && shown ? <span className={b.quiet} role="status">{t('business.owner.draftSaved')}</span> : null;
}
