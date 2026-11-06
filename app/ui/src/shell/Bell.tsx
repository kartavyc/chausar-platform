/**
 * The bell (Ink v2 wave 4, 4G4; spec 5.7, catalogue O12): NotificationBell wired to the engine's centre. It sits in every
 * page header's tools beside the rail (through PageTitle's ShellToolsContext) and in the phone's top bar, says how many
 * are new in its name only, and opens the centre sheet (`notifications`). The bell and the centre read one list,
 * `venture.notify.list`, held by NotifyProvider for the whole frame, so they never disagree; it is read again when the
 * engine says the centre changed (notify.new), when Today changes, and when the centre marks items read. When the count
 * of new items goes up, a polite live region says so once, for a screen reader.
 */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../text';
import { useResource, type Resource } from '../engine/context';
import { NotificationBell } from '../parts/NotificationBell';
import type { ResultOf, VentureRunEvent } from '../engine/types';
import { closeSheet, openSheet, useRoute } from './navigation';

/** The centre's sheet: one for the whole app. */
export const CENTRE_SHEET = { kind: 'notifications', id: 'all' } as const;

/** Events after which the centre may hold something new: the centre's own, Today's, and a run that waits. */
export const NOTIFY_EVENTS = (event: VentureRunEvent) => event.type === 'notify.new' || event.type === 'queue.changed' || event.type === 'run.waiting';

type NotifyList = Resource<ResultOf<'venture.notify.list'>>;
const NotifyContext = createContext<NotifyList | null>(null);

/** Holds the one list for the bell and the centre, and the live region that says a new count aloud. */
export function NotifyProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const list = useResource('venture.notify.list', {}, { refreshOn: NOTIFY_EVENTS });
  const [said, setSaid] = useState('');
  const before = useRef<number | null>(null);
  const unread = list.data?.unread;
  useEffect(() => {
    if (unread === undefined) return;
    if (before.current !== null && unread > before.current) setSaid(t('bell.new', { count: unread }));
    before.current = unread;
  }, [unread, t]);
  return (
    <NotifyContext.Provider value={list}>
      {children}
      <span className="sr-only" aria-live="polite" data-bell-live="">{said}</span>
    </NotifyContext.Provider>
  );
}

/** The shared list; a bell or centre drawn outside the provider (a part on its own) reads its own. */
export function useNotifyList(): NotifyList {
  const shared = useContext(NotifyContext);
  const own = useResource('venture.notify.list', {}, { refreshOn: NOTIFY_EVENTS, skip: shared !== null });
  return shared ?? own;
}

/** The bell. Where the engine cannot list the centre (no business open), there is no bell rather than a wrong one. */
export function Bell({ look = 'outlined' }: { look?: 'outlined' | 'bare' }) {
  const route = useRoute();
  const list = useNotifyList();
  if (list.error && !list.data) return null;
  const open = route.sheet?.kind === CENTRE_SHEET.kind;
  return (
    <NotificationBell
      unread={list.data?.unread ?? 0}
      look={look}
      expanded={open}
      onOpen={() => (open ? closeSheet() : openSheet(CENTRE_SHEET.kind, CENTRE_SHEET.id))}
    />
  );
}
