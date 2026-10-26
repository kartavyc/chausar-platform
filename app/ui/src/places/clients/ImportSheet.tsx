/**
 * The import sheet (`?sheet=network-import:new`, or `:<kind>` from "Import a newer file"; 4D4 from the engine's 4D1):
 * choose the kind of file, pick it, and Chausar checks it first (venture.network.import { check: true }: what it would
 * keep and leave out, with three samples, storing nothing), then Import, then Undo for that import, which asks once
 * more with the engine's own words for what would go.
 *
 * Where the file is read: on the desktop the desktop app picks and reads it on this computer and hands over only what
 * Chausar keeps (`pickNetworkFile`); mail headers come only that way, with the addresses the owner sends from. On the
 * web the page reads the file and sends it to the engine on this computer; the hosted app imports nothing and says so.
 * Every refusal (too large, a line that can't be read, the same file again) shows the engine's own words.
 */

import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Count } from '../../parts/Figure';
import { Field } from '../../parts/Field';
import { Icon } from '../../parts/Icon';
import { Sheet } from '../../parts/Sheet';
import type { NetworkImportKind, NetworkImportResult } from '../../engine/types';
import type { SheetComponentProps } from '../../shell/sheets';
import { clientsChanged } from './signals';
import { KIND_ICONS } from './NetworkSources';
import { messageOf } from './network';
import s from './Network.module.css';

const KINDS: readonly NetworkImportKind[] = ['linkedin-connections', 'contacts-csv', 'vcard', 'calendar-ics', 'linkedin-messages', 'mail-headers'];
const ACCEPT: Readonly<Record<NetworkImportKind, string>> = {
  'linkedin-connections': '.csv', 'linkedin-messages': '.csv', 'contacts-csv': '.csv', vcard: '.vcf,.vcard', 'calendar-ics': '.ics,.ical', 'mail-headers': '',
};

type File = { kind: NetworkImportKind; name: string; text: string };
type Step =
  | { kind: 'choose' }
  | { kind: 'busy' }
  | { kind: 'checked'; file: File; check: Extract<NetworkImportResult, { mode: 'check' }> }
  | { kind: 'imported'; done: Extract<NetworkImportResult, { mode: 'import' }> }
  | { kind: 'undoing'; done: Extract<NetworkImportResult, { mode: 'import' }>; line: string }
  | { kind: 'undone'; line: string };

export function ImportSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const engine = useEngine();
  const kindsId = useId();
  const [kind, setKind] = useState<NetworkImportKind | null>((KINDS as readonly string[]).includes(id) ? (id as NetworkImportKind) : null);
  const [addresses, setAddresses] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [problem, setProblem] = useState<string | null>(null);
  const hosted = engine.transport === 'hosted';
  const desktop = typeof engine.pickNetworkFile === 'function';

  async function check(file: File) {
    setStep({ kind: 'busy' });
    setProblem(null);
    try {
      const check = await engine.request('venture.network.import', { kind: file.kind, name: file.name, text: file.text, check: true });
      if (check.mode === 'check') setStep({ kind: 'checked', file, check });
      else setStep({ kind: 'choose' });
    } catch (error) {
      setProblem(messageOf(error));
      setStep({ kind: 'choose' });
    }
  }

  async function pickOnDesktop(chosen: NetworkImportKind) {
    setProblem(null);
    try {
      const owner = addresses.split(',').map((item) => item.trim()).filter(Boolean);
      const picked = await engine.pickNetworkFile!(chosen, chosen === 'mail-headers' ? { ownerAddresses: owner } : {});
      if (picked) await check({ kind: chosen, name: picked.name, text: picked.text });
    } catch (error) {
      setProblem(messageOf(error));
    }
  }

  async function readInPage(chosen: NetworkImportKind, picked: globalThis.File | undefined) {
    if (!picked) return;
    await check({ kind: chosen, name: picked.name, text: await picked.text() });
  }

  async function importFile(file: File) {
    setStep({ kind: 'busy' });
    setProblem(null);
    try {
      const done = await engine.request('venture.network.import', { kind: file.kind, name: file.name, text: file.text });
      if (done.mode === 'import') setStep({ kind: 'imported', done });
      clientsChanged(engine);
    } catch (error) {
      setProblem(messageOf(error));
      setStep({ kind: 'choose' });
    }
  }

  async function undo(done: Extract<NetworkImportResult, { mode: 'import' }>, confirmed: boolean) {
    setProblem(null);
    try {
      const result = await engine.request('venture.network.importUndo', { importId: done.import.id, ...(confirmed ? {} : { preview: true }) });
      if (confirmed) { setStep({ kind: 'undone', line: result.line }); clientsChanged(engine); } else setStep({ kind: 'undoing', done, line: result.line });
    } catch (error) {
      setProblem(messageOf(error));
    }
  }

  const choosing = step.kind === 'choose' || step.kind === 'busy';
  return (
    <Sheet label={t('clients.import.sheet')} title={t('clients.import.title')} line={t('clients.import.line')} onClose={onClose} returnFocus={returnFocus}>
      {hosted ? <p className={s.said}>{t('clients.import.hosted')}</p> : (
        <>
          {choosing && (
            <fieldset className={s.kinds} aria-labelledby={kindsId}>
              <legend id={kindsId} className={s.heading}>{t('clients.import.kind')}</legend>
              {KINDS.map((item) => (
                <label key={item} className={s.kindChoice}>
                  <input type="radio" name="network-kind" value={item} checked={kind === item} onChange={() => { setKind(item); setProblem(null); }} />
                  <Icon name={KIND_ICONS[item]} size={16} />
                  {t(`clients.import.kind.${item}`)}
                </label>
              ))}
            </fieldset>
          )}

          {choosing && kind && (
            <div className={s.pick}>
              {kind === 'mail-headers' && !desktop && <p className={s.quiet}>{t('clients.import.mailDesktop')}</p>}
              {kind === 'mail-headers' && desktop && (
                <Field label={t('clients.import.addresses')} hint={t('clients.import.addresses.hint')} value={addresses} onChange={(event) => setAddresses(event.target.value)} autoComplete="off" />
              )}
              {desktop && (
                <Button disabled={step.kind === 'busy'} onClick={() => void pickOnDesktop(kind)}><Icon name="upload" size={16} />{t('clients.import.choose')}</Button>
              )}
              {!desktop && kind !== 'mail-headers' && (
                <label className={s.fileLabel}>
                  <Icon name="upload" size={16} />
                  <span>{t('clients.import.choose')}</span>
                  <input
                    type="file"
                    className="sr-only"
                    aria-label={t('clients.import.choose')}
                    accept={ACCEPT[kind] || undefined}
                    disabled={step.kind === 'busy'}
                    onChange={(event) => { void readInPage(kind, event.target.files?.[0]); event.target.value = ''; }}
                  />
                </label>
              )}
              {step.kind === 'busy' && <p className={s.quiet} role="status">{t('clients.import.checking')}</p>}
            </div>
          )}

          {step.kind === 'checked' && (
            <div className={s.checked}>
              <p className={s.said}>{step.check.line}</p>
              {step.check.samples.length > 0 && (
                <>
                  <p className={s.label}>{t('clients.import.samples')}</p>
                  <ul className={s.lines}>
                    {step.check.samples.map((sample, index) => (
                      <li key={index}><span data-content="">{sample.name}</span>{sample.line && <> <span className={s.source} data-content="">{sample.line}</span></>}</li>
                    ))}
                  </ul>
                </>
              )}
              {step.check.dropped.length > 0 && (
                <>
                  <p className={s.label}>{t('clients.import.dropped')}</p>
                  <ul className={s.lines}>{step.check.dropped.map((item) => <li key={item.what}>{item.what} <Count value={item.count} /></li>)}</ul>
                </>
              )}
              <div className={s.actions}>
                <Button variant="quiet" onClick={() => setStep({ kind: 'choose' })}>{t('clients.import.again')}</Button>
                <Button variant="primary" onClick={() => void importFile(step.file)}>{t('clients.import.go')}</Button>
              </div>
            </div>
          )}

          {step.kind === 'imported' && (
            <div className={s.checked}>
              <p className={s.said} role="status">{step.done.line}</p>
              <div className={s.actions}><Button onClick={() => void undo(step.done, false)}>{t('clients.import.undo')}</Button></div>
            </div>
          )}

          {step.kind === 'undoing' && (
            <div className={s.ask}>
              <p>{step.line}</p>
              <div className={s.actions}>
                <Button variant="quiet" onClick={() => setStep({ kind: 'imported', done: step.done })}>{t('clients.import.undo.keep')}</Button>
                <Button onClick={() => void undo(step.done, true)}>{t('clients.import.undo.confirm')}</Button>
              </div>
            </div>
          )}

          {step.kind === 'undone' && <p className={s.said} role="status">{step.line}</p>}
          {problem && <p className={s.problem} role="alert">{problem}</p>}
        </>
      )}
    </Sheet>
  );
}
