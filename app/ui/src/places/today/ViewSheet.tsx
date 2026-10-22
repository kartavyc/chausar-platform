import { useEffect } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { Sheet } from '../../parts/Sheet';
import type { SheetComponentProps } from '../../shell/sheets';
import type { QueueItemView } from '../../engine/types';
import { useTodaySession } from './session';
import s from './Today.module.css';

const KINDS: readonly QueueItemView['kind'][] = ['draft', 'file', 'plan'];

/** `view:<kind>:<id>`, the address of what a row points at. */
export const viewSheetId = (ref: { kind: QueueItemView['kind']; id: string }) => `${ref.kind}:${ref.id}`;

/**
 * The thing a row asks the owner to look at before approving: a draft, a file or a plan, as text. Once its content is
 * on screen the row's Approve unlocks (the session marks that version seen); a sheet that fails to load unlocks
 * nothing.
 */
export function ViewSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const session = useTodaySession();
  const at = id.indexOf(':');
  const kind = id.slice(0, at) as QueueItemView['kind'];
  const ref = id.slice(at + 1);
  const known = at > 0 && KINDS.includes(kind) && ref.length > 0;
  const view = useResource('venture.queue.view', { kind, id: ref }, { skip: !known });
  const data = view.data;

  useEffect(() => {
    if (!data) return;
    session.show(id);
    return () => session.unshow(id);
  }, [data, session, id]);

  if (!known) return <Sheet label="" title={t('sheet.unknown')} onClose={onClose} returnFocus={returnFocus} />;
  const label = t(`today.view.${kind}`);
  if (!data) {
    return (
      <Sheet label={label} title={view.error ? t('today.view.missing') : t('sheet.loading')} onClose={onClose} returnFocus={returnFocus}>
        {view.error && <p className={s.failed}>{view.error.message}</p>}
      </Sheet>
    );
  }
  return (
    <Sheet
      label={label}
      eyebrow={data.agent ? `${data.businessName} · ${data.agent}` : data.businessName}
      title={data.title}
      line={data.line}
      onClose={onClose}
      returnFocus={returnFocus}
    >
      {data.sections.map((section, i) => (
        <section key={`${section.heading ?? ''}:${i}`} className={s.part}>
          {section.heading && <h3 className={s.partHeading}>{section.heading}</h3>}
          <ul className={s.lines}>
            {section.lines.map((text, j) => <li key={`${j}:${text}`}>{text}</li>)}
          </ul>
        </section>
      ))}
    </Sheet>
  );
}
