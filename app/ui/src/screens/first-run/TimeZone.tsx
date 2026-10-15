/**
 * The business time zone, in first run (on the step after the vault) and in settings. The
 * stored zone comes from `ui.context.timeZone`; the machine's own zone is offered only as a
 * suggestion the person confirms with "Use this zone" (nothing is written until then). The
 * list is the runtime's IANA list. Saving calls core-data's `workspace.setTimeZone`
 * (contract in `bridge/r4-contracts.ts`); `ui.context.timeZone` then drives Activity and receipts
 * once the host reads the context again (`onSaved`).
 */

import { useEffect, useId, useMemo, useState } from 'react';
import { useT } from '../../app/text';
import { contextTimeZone, isTimeZone, isTimeZoneReply } from '../../bridge/r4-contracts.ts';
import { failureOf, type JourneyFailure } from './journey-contracts.ts';
import { Act, Actions, FailureLine } from './JourneyParts';
import type { ComputerPort } from './this-computer.ts';
import s from './Journey.module.css';

/** Every IANA zone this runtime knows, sorted; a short list when the runtime cannot say. */
export function timeZoneList(): readonly string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try { const all = intl.supportedValuesOf?.('timeZone'); if (all && all.length > 0) return [...new Set([...all, 'UTC'])].sort(); } catch { /* fall through */ }
  return ['Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC'];
}

/** The machine's zone, as a suggestion only; null when the runtime gives none it can use. */
export function machineTimeZone(): string | null {
  try { const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone; return isTimeZone(zone) ? zone : null; } catch { return null; }
}

/** core-data's refusals (`workspace.setTimeZone`) said in this screen's words. */
const OWN_WORDS: Readonly<Record<string, string>> = {
  FORBIDDEN: 'TZ.owner', ACCESS_DENIED: 'TZ.owner', INVALID_TIME_ZONE: 'TZ.invalid', TAINTED_SETTING: 'TZ.tainted',
};

type Stored ={ readonly kind: 'reading' } | { readonly kind: 'known'; readonly zone: string | null } | JourneyFailure;
type Saving = 'idle' | 'saving' | { readonly kind: 'saved'; readonly zone: string } | JourneyFailure;

export interface TimeZoneSettingProps {
  readonly rpc: ComputerPort;
  /** After a zone is saved: the host reads `ui.context` again. */
  readonly onSaved?: ((zone: string) => void) | undefined;
  /** The machine's zone; tests pass their own. */
  readonly suggest?: (() => string | null) | undefined;
}

export function TimeZoneSetting({ rpc, onSaved, suggest = machineTimeZone }: TimeZoneSettingProps) {
  const t = useT();
  const fieldId = useId();
  const zones = useMemo(timeZoneList, []);
  const suggestion = useMemo(suggest, [suggest]);
  const [stored, setStored] = useState<Stored>({ kind: 'reading' });
  const [choice, setChoice] = useState('');
  const [saving, setSaving] = useState<Saving>('idle');
  useEffect(() => {
    let live = true;
    void rpc.request('ui.context', {}).then(reply => {
      if (!live) return;
      const read = contextTimeZone(reply);
      if (read === null) { setStored({ kind: 'refused', code: 'INVALID_REPLY' }); return; }
      setStored({ kind: 'known', zone: read.timeZone });
      setChoice(read.timeZone ?? suggestion ?? 'UTC');
    }, (error: unknown) => { if (live) setStored(failureOf(error)); });
    return () => { live = false; };
  }, [rpc, suggestion]);

  const save = async () => {
    if (!isTimeZone(choice)) return;
    setSaving('saving');
    try {
      const reply = await rpc.request('workspace.setTimeZone', { timeZone: choice });
      // core-data answers with the zone list's own spelling of the name: the same zone, never another one.
      if (!isTimeZoneReply(reply) || reply.timeZone.toLowerCase() !== choice.toLowerCase()) { setSaving({ kind: 'refused', code: 'INVALID_REPLY' }); return; }
      setStored({ kind: 'known', zone: reply.timeZone }); setChoice(reply.timeZone); setSaving({ kind: 'saved', zone: reply.timeZone });
      onSaved?.(reply.timeZone);
    } catch (error) { setSaving(failureOf(error)); }
  };

  if (stored.kind === 'reading') return null;
  if (stored.kind !== 'known') return <section className={s.section} data-time-zone={stored.kind}><FailureLine failure={stored} notBuilt="TZ.notBuilt" refused="TZ.refused" /></section>;
  const options = zones.includes(choice) ? zones : [choice, ...zones];
  return (
    <section className={s.section} data-time-zone={stored.zone ?? 'none'}>
      <h2 className={s.sectionTitle}>{t('TZ.title')}</h2>
      <p className={s.note}>{t('TZ.lede')}</p>
      <p className={s.status} data-time-zone-current="">{stored.zone === null ? t('TZ.none') : t('TZ.current', { zone: stored.zone })}</p>
      {stored.zone === null && suggestion !== null && <p className={s.note} data-time-zone-suggested={suggestion}>{t('TZ.suggested', { zone: suggestion })}</p>}
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className={s.fields}>
          <label htmlFor={fieldId}>{t('TZ.field')}</label>
          <select id={fieldId} value={choice} onChange={event => { setChoice(event.currentTarget.value); setSaving('idle'); }}>
            {options.map(zone => <option key={zone} value={zone}>{zone}</option>)}
          </select>
        </div>
        <Actions><Act submit label="TZ.save.btn" disabled={saving === 'saving' || !isTimeZone(choice)} /></Actions>
      </form>
      {typeof saving === 'object' && saving.kind === 'saved' && <p className={s.status} role="status">{t('TZ.saved', { zone: saving.zone })}</p>}
      {typeof saving === 'object' && saving.kind === 'not-built' && <FailureLine failure={saving} notBuilt="TZ.notBuilt" refused="TZ.refused" />}
      {typeof saving === 'object' && saving.kind === 'refused' && (OWN_WORDS[saving.code] !== undefined
        ? <p className={s.problem} role="alert" data-time-zone-refused={saving.code}>{t(OWN_WORDS[saving.code]!)}</p>
        : <FailureLine failure={saving} notBuilt="TZ.notBuilt" refused="TZ.refused" />)}
    </section>
  );
}
