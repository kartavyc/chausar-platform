/**
 * Sheet kinds. The shell shows one sheet at a time from the address (?sheet=<kind>:<id>). The foundation provides
 * `run` and `receipt`; a place adds its own by exporting `sheets` from its index.tsx (see places.ts).
 */

import type { ReactNode } from 'react';
import { useT } from '../text';
import { useResource } from '../engine/context';
import { RunSheet } from '../parts/RunSheet';
import { Sheet } from '../parts/Sheet';
import s from './sheets.module.css';

export interface SheetComponentProps {
  id: string;
  onClose: () => void;
  /** Pass to <Sheet returnFocus>: puts focus back on the row that opened the sheet. */
  returnFocus: () => void;
}
export type SheetComponent = (props: SheetComponentProps) => ReactNode;

function RunSheetKind({ id, onClose, returnFocus }: SheetComponentProps) {
  return <RunSheet runId={id} onClose={onClose} returnFocus={returnFocus} />;
}

function ReceiptSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const receipt = useResource('venture.receipt.get', { id });
  return (
    <Sheet label={t('sheet.receipt')} title={<span className="mono">{id}</span>} onClose={onClose} returnFocus={returnFocus}>
      {receipt.error && <p className={s.failed}>{t('sheet.failed', { message: receipt.error.message })}</p>}
      {!receipt.data && !receipt.error && <p className={s.quiet}>{t('sheet.loading')}</p>}
      {receipt.data && (
        <>
          {receipt.data.stale && <p className={s.stale}>{t('receipt.stale')}</p>}
          {receipt.data.figures.length > 0 ? (
            <dl className={s.figures}>
              {receipt.data.figures.map((figure) => (
                <div key={figure.key} className={s.figure}>
                  <dt>{figure.label}</dt>
                  <dd className="mono">{figure.display}</dd>
                </div>
              ))}
            </dl>
          ) : <p className={s.quiet}>{t('receipt.none')}</p>}
          <p className={s.explanation}>{receipt.data.explanation}</p>
        </>
      )}
    </Sheet>
  );
}

/** Shown for a sheet kind nobody registered yet: says so, never pretends. */
export function UnknownSheet({ onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  return <Sheet label="" title={t('sheet.unknown')} onClose={onClose} returnFocus={returnFocus} />;
}

export const BASE_SHEETS: Readonly<Record<string, SheetComponent>> = { run: RunSheetKind, receipt: ReceiptSheet };
