/**
 * Opening a link (SH-10). A link in an answer or a file never opens on its own: this small
 * dialog shows the full address as text, with "Open in your browser" and Cancel. Opening is
 * a callback intent (`shell.openExternal` in the trusted host); the app window never goes
 * to another page. The address is drawn as plain text, never as a live link.
 *
 * Dialog behaviour (focus held inside, Esc to cancel, focus returned) comes from React Aria.
 */

import { Dialog } from 'react-aria-components/Dialog';
import { Heading } from 'react-aria-components/Heading';
import { ModalOverlay, Modal } from 'react-aria-components/Modal';
import { useT } from './text';
import { Button } from '../parts/Button';
import s from './ShellSheets.module.css';

export interface LinkDialogProps {
  /** The address to ask about, exactly as found. Null: no dialog. */
  url: string | null;
  /** The person chose to open it. Called with the same address that was shown. */
  onOpen: (url: string) => void;
  onCancel: () => void;
  /** The host could not open it (not a secure named web address, or refused by the shell). */
  refused?: boolean | undefined;
  /** The open is on its way: the button waits. */
  busy?: boolean | undefined;
}

export function LinkDialog({ url, onOpen, onCancel, refused = false, busy = false }: LinkDialogProps) {
  const t = useT();
  if (url === null) return null;
  return (
    <ModalOverlay
      className={[s.overlay].join(' ')}
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <Modal>
        <Dialog className={[s.dialog].join(' ')}>
          <Heading slot="title" className={[s.title].join(' ')}>
            {t('SH-10.title')}
          </Heading>
          <p className={s.note}>{t('SH-10.note')}</p>
          <p className={s.code} data-url="">
            {url}
          </p>
          {refused && <p className={s.note} role="alert" data-link-refused="">{t('SH-10.refused')}</p>}
          <div className={s.actions}>
            <Button variant="filled" disabled={busy || refused} onClick={() => onOpen(url)}>
              {t('SH-10.open')}
            </Button>
            <Button onClick={onCancel}>{t('SH-10.cancel')}</Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
