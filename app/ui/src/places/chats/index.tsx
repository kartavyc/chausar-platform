/**
 * Chats (Ink v2 wave 4, 4C2; spec 5.4; the founder's decision of 23 October; the direction D board D-Chats): the owner
 * talks to Chausar itself, as chief of staff. It answers from the open business's records with receipts (and from what
 * was saved about the other businesses on this computer, never a locked one), and it acts only through approvals:
 * anything that spends, sends or changes prices becomes a card on Today, and only when the owner presses Start.
 *
 * `#/chats` is a new chat beside the list; `#/chats?thread=<id>` one chat. On a phone the list and the chat take the
 * screen in turn: `#/chats/new` (or words handed over from elsewhere) is a new chat there. Words handed over from the
 * header box, Ctrl K, Today's Chausar story or Start's questions arrive in the composer, unsent (shell/ask.ts).
 */

import { useState } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import type { VentureRunEvent } from '../../engine/types';
import { askChausar, useAskWords } from '../../shell/ask';
import { goTo, useRoute } from '../../shell/navigation';
import { useNarrow } from '../../shell/useNarrow';
import { PageTitle } from '../../parts/PageTitle';
import { ChatList } from './ChatList';
import { ChiefThread } from './ChiefThread';
import s from './Chats.module.css';

/** The list reads again when Chausar answers in any chat. */
const LIST_EVENTS = (event: VentureRunEvent) => event.type === 'chief.message';

export function Place() {
  const t = useT();
  const route = useRoute();
  const phone = useNarrow();
  const threads = useResource('venture.chief.threads', {}, { refreshOn: LIST_EVENTS });
  const [ask, setAsk] = useState<{ words: string; n: number } | null>(null);
  useAskWords((words) => {
    setAsk((was) => ({ words, n: (was?.n ?? 0) + 1 }));
    if (phone) goTo('chats', 'new');
  });

  const threadId = route.query.thread;
  const newChat = route.sub === 'new';
  const showList = !phone || (!threadId && !newChat);
  const showThread = !phone || Boolean(threadId) || newChat;

  return (
    <div className={s.page}>
      <PageTitle title={t('chats.title')} line={t('chats.line')} />
      <div className={s.layout} data-phone={phone ? '' : undefined}>
        {showList && <ChatList threads={threads} selected={threadId} onNew={() => askChausar('')} />}
        {showThread && <ChiefThread threadId={threadId} ask={ask} onListChanged={threads.reload} phone={phone} />}
      </div>
    </div>
  );
}
