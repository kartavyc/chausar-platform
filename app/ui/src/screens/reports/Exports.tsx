/**
 * RP-07 Exports: "Export everything" for the owner, with the warning that exported files
 * are not encrypted and the choice of a locked archive before it runs, a confirmation step,
 * and afterwards each store with its row count and check number. Earlier exports are
 * listed for every seat. Ask a person (RP-08) opens as the sheet `ask-a-person`.
 */
import { useRef, useState } from 'react';
import type { Language } from '../../app/presentation.ts';
import { withSheet, withoutSheet } from '../../app/routes.ts';
import { Button } from '../../parts/Button';
import { YesNo } from '../../parts/Choice';
import { Sheet } from '../../parts/Sheet';
import type { PlaceRenderProps } from '../../places/types.ts';
import { words } from '../../places/types.ts';
import { count } from '../../format/index.ts';
import { useEngine, useSend } from '../trust/kit/engine.ts';
import { Group, Note, Screen } from '../trust/kit/Screen';
import { AskPersonSheet } from './AskPerson';
import { refusal, when } from './shared';
import { validateExportRecord, validateExports, type ExportRecord } from './validate.ts';
import { WORDS, fill, type Words } from './words.ts';
import s from './Reports.module.css';

export function Exports(props: PlaceRenderProps) {
  const { address, language, view, member, viewer, rpc, navigate } = props;
  const w = words(WORDS, language);
  const { state, reload } = useEngine(rpc, 'reportsx.exports', {}, validateExports);
  const exporter = useSend(rpc, validateExportRecord);
  const [step, setStep] = useState<'idle' | 'confirm'>('idle');
  const [locked, setLocked] = useState(false);
  const origin = useRef<HTMLElement | null>(null);
  const owner = !viewer && member.role === 'owner';
  const close = () => navigate(withoutSheet(address));
  const ask = (
    <Button variant="link" onClick={(e) => { origin.current = e.currentTarget; navigate(withSheet(address, 'ask-a-person')); }}>{w.askLink}</Button>
  );
  const run = () => {
    void exporter.send('reportsx.exportAll', { confirmed: true, locked }).then((r) => { if (r !== null) { setStep('idle'); reload(); } });
  };

  return (
    <>
      <Screen where={w.where} title={w.exports} loaded={state} aside={ask}>
        {(value) => (
          <>
            <Group title={w.exportAll}>
              <p className={s.say}>{w.exportWarning}</p>
              {!owner ? <Note>{w.ownerOnly}</Note> : step === 'idle' ? (
                <div className={s.stack}>
                  <YesNoRow label={w.lockedChoice} value={locked} onChange={setLocked} />
                  <div><Button variant="filled" onClick={() => { exporter.clear(); setStep('confirm'); }}>{w.exportAll}</Button></div>
                </div>
              ) : (
                <div className={s.stack} role="group" aria-label={w.confirmTitle}>
                  <p className={s.say}>{w.confirmTitle}</p>
                  <p className={s.quiet}>{locked ? w.locked : `${w.notLocked} · ${w.exportWarning}`}</p>
                  <div className={s.actions}>
                    <Button variant="filled" disabled={exporter.sent.kind === 'sending'} onClick={run}>{exporter.sent.kind === 'sending' ? w.exportingAll : w.confirm}</Button>
                    <Button onClick={() => setStep('idle')} disabled={exporter.sent.kind === 'sending'}>{w.cancel}</Button>
                  </div>
                </div>
              )}
              {exporter.sent.kind === 'refused' && <Note status>{refusal(exporter.sent.code, w)}</Note>}
              {exporter.sent.kind === 'done' && (
                <div className={s.stack} role="status">
                  <p className={s.say}>{w.exportDone}</p>
                  <Record record={exporter.sent.value} w={w} language={language} view={view} />
                </div>
              )}
            </Group>
            <Group title={w.earlier}>
              {value.items.length === 0 ? <Note>{w.noExports}</Note> : value.items.map((r) => <Record key={r.id} record={r} w={w} language={language} view={view} />)}
            </Group>
          </>
        )}
      </Screen>
      {address.sheet === 'ask-a-person' && <AskPersonSheet {...props} origin={origin.current} onClose={close} />}
      {address.sheet !== undefined && address.sheet !== 'ask-a-person' && (
        <Sheet kind={w.exports} title={w.exports} onClose={close} origin={origin.current}><Note>{w.unknownSheet}</Note></Sheet>
      )}
    </>
  );
}

function YesNoRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={s.actions}>
      <span className={s.say}>{label}</span>
      <YesNo label={label} value={value} onChange={onChange} />
    </div>
  );
}

function Record({ record, w, language, view }: { record: ExportRecord; w: Words; language: Language; view: PlaceRenderProps['view'] }) {
  return (
    <section className={s.stack} aria-label={fill(w.exportedAt, { when: when(record.at, w, language) })}>
      <p className={s.say}>{fill(w.exportedAt, { when: when(record.at, w, language) })}</p>
      <p className={s.quiet}>{`${record.locked ? w.locked : w.notLocked} · ${record.encrypted ? w.encrypted : w.exportWarning}`}</p>
      {view !== 'simple' && <p className={[s.quiet, s.code].join(' ')}>{fill(w.folder, { folder: record.folder })}</p>}
      <table className={s.table}>
        <caption className="sr">{w.stores}</caption>
        <thead><tr><th scope="col">{w.storeName}</th><th scope="col" className={s.num}>{w.storeRows}</th><th scope="col">{w.storeCheck}</th></tr></thead>
        <tbody>
          {record.stores.map((store) => (
            <tr key={store.name}>
              <th scope="row">{store.name}</th>
              <td className={s.num}>{count(String(store.rows))}</td>
              <td className={s.code}>{store.checkNumber}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
