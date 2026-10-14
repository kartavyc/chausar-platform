/**
 * RP-01 Packs: the lender, CA and investor packs as groups of page rows. Each page says
 * its state in words; each pack says which GST modes it applies to. A page opens as the
 * sheet `<pack>.<page>` (RP-02).
 */
import { useRef } from 'react';
import type { Mark, RowItem } from '../../app/presentation.ts';
import { withSheet, withoutSheet } from '../../app/routes.ts';
import { RowList } from '../../parts/RowList';
import { Sheet } from '../../parts/Sheet';
import type { PlaceRenderProps } from '../../places/types.ts';
import { words } from '../../places/types.ts';
import { useEngine } from '../trust/kit/engine.ts';
import { Group, Note, Screen } from '../trust/kit/Screen';
import { ReportPageSheet } from './ReportPage';
import { when } from './shared';
import { SHEET_ID, pageSheet, validatePacks, type PageState } from './validate.ts';
import { WORDS, fill } from './words.ts';
import s from './Reports.module.css';

const MARK: Readonly<Record<PageState, Mark>> = { 'ready-tested': 'cha', 'ready-untested': 'unsure', 'not-started': 'off' };

export function Packs(props: PlaceRenderProps) {
  const { address, language, view, rpc, openReceipt, navigate } = props;
  const w = words(WORDS, language);
  const { state } = useEngine(rpc, 'reportsx.packs', {}, validatePacks);
  const origin = useRef<HTMLElement | null>(null);
  const target = pageSheet(address.sheet);
  const close = () => navigate(withoutSheet(address));

  return (
    <>
      <Screen where={w.where} title={w.packs} loaded={state}>
        {(value) => (
          <>
            <Note>{w.packsNote}</Note>
            {value.packs.length === 0 && <Note>{w.packsEmpty}</Note>}
            {value.packs.map((pack) => {
              const modes = pack.gstModes.map((m) => w[`gst.${m}`]).join(', ');
              const rows: RowItem[] = pack.pages.map((page) => {
                const stateWords = w[`state.${page.state}`];
                const note = page.reason !== null ? fill(w.stateWithReason, { state: stateWords, reason: page.reason }) : stateWords;
                return { id: `${pack.id}.${page.id}`, mark: MARK[page.state], what: page.title, note: view === 'books' ? `${note} · ${page.id}` : note };
              });
              return (
                <Group key={pack.id} title={pack.title} note={fill(w.packGst, { modes })}>
                  {rows.length === 0 ? <Note>{w.pagesEmpty}</Note> : (
                    <RowList rows={rows} selectedId={address.sheet} onReceipt={openReceipt}
                      opens={(row) => SHEET_ID.test(row.id) && pageSheet(row.id) !== null}
                      onOpen={(id, el) => { origin.current = el; navigate(withSheet(address, id)); }} />
                  )}
                </Group>
              );
            })}
            {view !== 'simple' && <p className={s.quiet}>{fill(w.checkedAt, { when: when(value.checkedAt, w, language) })}</p>}
          </>
        )}
      </Screen>
      {address.sheet !== undefined && (target !== null
        ? <ReportPageSheet {...props} pack={target.pack} page={target.page} origin={origin.current} onClose={close} />
        : <Sheet kind={w.pageKind} title={w.pageKind} onClose={close} origin={origin.current}><Note>{w.badSheet}</Note></Sheet>)}
    </>
  );
}
