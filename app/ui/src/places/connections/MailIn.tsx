/**
 * Connections, "Mail files" (Ink v2 wave 5, 5A6; the engine's build/mail-in.ts): no second mailbox reader. An owner
 * without a connected mailbox exports the mails as .eml or .mbox files and imports them here; each message is screened
 * before anything is kept, and lands with the mailbox's own (4E3) so a desk sees one inbox. The engine takes files up to
 * 25 MB; the desktop app's requests carry at most about 1.4 MB of file, so a bigger file is refused here, before it is
 * read, with the way round. Threads show their subject only (the sender's words, so in [data-content]).
 */

import { useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Icon } from '../../parts/Icon';
import { readBase64 } from '../work/files';
import { codeWords } from './KitConnect';
import s from './Mailbox.module.css';
import k from './KitConnect.module.css';

/** The most of a file the desktop app's request carries once it is base64 (its 2 MB request limit, with room to spare). */
const DESKTOP_FILE_BYTES = 1_400_000;

export function MailIn() {
  const t = useT();
  const engine = useEngine();
  const threads = useResource('venture.mail.threads', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const [said, setSaid] = useState<{ text: string; problem: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function importFile(file: File | undefined) {
    if (!file || busy) return;
    setSaid(null);
    if (engine.transport === 'desktop' && file.size > DESKTOP_FILE_BYTES) { setSaid({ text: t('kit-connect.mail.tooBig'), problem: true }); return; }
    setBusy(true);
    try {
      const done = await engine.request('venture.mail.import', { name: file.name, contentBase64: await readBase64(file) });
      setSaid({ text: done.line, problem: false });
      threads.reload();
    } catch (error) {
      setSaid({ text: codeWords(error, t), problem: true });
    } finally {
      setBusy(false);
    }
  }

  const recent = threads.data?.threads.slice(0, 3) ?? [];
  return (
    <div role="region" aria-label={t('kit-connect.mail.title')} className={s.card} data-mail-in="">
      <p className={s.quiet}>{t('kit-connect.mail.line')}</p>
      {threads.data && !threads.data.mailbox.connected && <p className={k.small} data-manual-path="">{threads.data.mailbox.manualPath}</p>}
      <div className={s.actions}>
        <label className={k.file}>
          <Icon name="upload" size={16} />
          <span>{t('kit-connect.mail.import')}</span>
          <input
            type="file" className="sr-only" accept=".eml,.mbox,message/rfc822,application/mbox" disabled={busy} aria-label={t('kit-connect.mail.import')}
            onChange={(event) => { void importFile(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }}
          />
        </label>
      </div>
      {said && <p className={said.problem ? s.problem : s.said} role="status">{said.text}</p>}
      {recent.length > 0 && (
        <>
          <p className={k.small}>{t('kit-connect.mail.threads')}</p>
          <ul className={k.list}>
            {recent.map((thread) => (
              <li key={thread.id} className={k.item} data-thread={thread.id}>
                <span className={k.content} data-content="">{thread.subject}</span>
                {thread.held && <span className={k.small}>{t('kit-connect.mail.held')}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
