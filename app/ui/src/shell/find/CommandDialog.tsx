/**
 * The command bar as a dialog (C2 tasks 6 and 8): where no header bar shows, on a phone and on Chats beside the rail,
 * Ctrl K and the phone's search button open it. On a phone it covers the screen under the status line as a sheet does,
 * and the frame makes the top bar, the place and the tabs inert while it is open; beside the rail it lies over the top
 * of the page. Focus goes to the box, and back to the control that opened it when it closes.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useT } from '../../text';
import { Icon } from '../../parts/Icon';
import { CommandBox } from './CommandBox';
import s from './CommandBox.module.css';

let opener: HTMLElement | null = null;
let open = false;
const listeners = new Set<() => void>();
const tell = () => { for (const listener of [...listeners]) listener(); };

/** Opens the dialog; `from` (or what has focus) gets focus back when it closes. */
export function openFindDialog(from?: Element | null): void {
  if (open) return;
  const element = (from ?? document.activeElement) as HTMLElement | null;
  opener = element && element !== document.body ? element : null;
  open = true;
  tell();
}

/** Closes the dialog. `refocus` false: a chosen row went somewhere else, so focus stays where that place puts it. */
export function closeFindDialog(refocus = true): void {
  if (!open) return;
  open = false;
  const back = opener;
  opener = null;
  tell();
  if (refocus && back?.isConnected) back.focus();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => open;

export function useFindDialogOpen(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function CommandDialog({ cover }: { cover: boolean }) {
  const t = useT();
  const shown = useFindDialogOpen();
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shown) return;
    holder.current?.querySelector<HTMLInputElement>('input[role="combobox"]')?.focus();
  }, [shown]);
  // Forget remounts the frame: a dialog left open closes, and nothing it held is kept.
  useEffect(() => () => { open = false; opener = null; }, []);

  if (!shown) return null;
  return (
    <div ref={holder} className={s.dialog} data-cover={cover ? '' : undefined} role="dialog" aria-modal="true" aria-label={t('find.label')}>
      <div className={s.dialogHead}>
        <CommandBox variant="dialog" opener={() => opener} onDone={(chosen) => closeFindDialog(!chosen)} />
        <button type="button" className={s.close} aria-label={t('find.close')} onClick={() => closeFindDialog()}>
          <Icon name="x" size={18} />
        </button>
      </div>
    </div>
  );
}
