/**
 * Connections, the shared connectors of Ink v2 wave 5 (package 5A6; the engine's build/monitors.ts, mail-in.ts,
 * local-apps.ts, webhook-handoff.ts and speech-out.ts): pages you watch, mail files you import, apps on this computer,
 * your own n8n or Make, and speech from text. Simple first: at rest one closed fold, "More ways to connect" (Connections
 * was at its word budget, so only the fold's words show); open, it lists connectors by name with their honest labels, and
 * opening one shows its line, its state and its one action, one at a time. The engine's refusals are worded here in
 * both languages by code (codeWords).
 */

import { useId, useState, type ComponentType } from 'react';
import { useT, type T } from '../../text';
import { useResource } from '../../engine/context';
import { EngineError } from '../../engine/types';
import { ConnectorLabel, type ConnectorLabelName } from '../../parts/ConnectorLabel';
import { Icon } from '../../parts/Icon';
import { Tile } from '../../parts/Tile';
import { Monitors } from './Monitors';
import { MailIn } from './MailIn';
import { LocalApps } from './LocalApps';
import { Webhooks } from './Webhooks';
import { SpeechOut } from './SpeechOut';
import {OpenPosting} from './OpenPosting';
import { SeoConnections } from './SeoConnections';
import { WebSearch } from './WebSearch';
import { PeopleSearch } from './PeopleSearch';
import s from './Mailbox.module.css';
import k from './KitConnect.module.css';
import { Fold } from '../../parts/Fold';

/** Engine codes these tiles word themselves; any other refusal shows the engine's own words. */
const WORDED = new Set(['FETCH_POLICY_REFUSED', 'ROBOTS_REFUSED', 'NET_ADDRESS_REFUSED', 'MONITOR_LIMIT', 'MAIL_FILE_TOO_LARGE', 'MAIL_FILE_UNREADABLE', 'WEBHOOK_REFUSED', 'TIER_UNAVAILABLE', 'INVALID_AMOUNT']);

/** A refusal in the owner's language when its code is one these tiles word, else the engine's words. */
export function codeWords(error: unknown, t: T): string {
  if (error instanceof EngineError && WORDED.has(error.code)) return t(`kit-connect.code.${error.code}`);
  return error instanceof Error ? error.message : String(error);
}

function SearchPublishing(){return <SeoConnections embedded/>;}

/** W6 6F3, 6F8: a part built but not yet run on a real account says fixture-tested in words, never a live label. */
type Part = { id: string; title: string; label: ConnectorLabelName | 'fixture-tested'; Body: ComponentType };

/** Connectors in the order the owner meets them; each opens below its row, one at a time. */
export function KitConnect() {
  const t = useT();
  const titleId = useId();
  const apps = useResource('venture.localApps.list', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const speech = useResource('venture.speechOut.providers', {});
  const [open, setOpen] = useState<string | null>(null);
  const parts: Part[] = [
    {id:'open-posting',title:t('pb-open-posting.title'),label:'write',Body:OpenPosting},
    { id: 'seo-publishing', title: t('pb-seo-connect.title'), label: 'write', Body: SearchPublishing },
    { id: 'monitors', title: t('kit-connect.monitors.title'), label: 'read', Body: Monitors },
    { id: 'mail', title: t('kit-connect.mail.title'), label: 'read', Body: MailIn },
    { id: 'apps', title: t('kit-connect.apps.title'), label: apps.data?.apps.some((app) => app.found) ? 'write' : 'planned', Body: LocalApps },
    { id: 'webhook', title: t('kit-connect.webhook.title'), label: 'write', Body: Webhooks },
    { id: 'speech', title: t('kit-connect.speech.title'), label: speech.data?.providers.some((item) => item.label === 'write') ? 'write' : 'planned', Body: SpeechOut },
    // W6 6F3: Chausar's polite page reader reads (run live); 6F8: people search waits on the owner's own keys.
    { id: 'web-search', title: t('web-people.search.title'), label: 'read', Body: WebSearch },
    { id: 'people-search', title: t('web-people.people.title'), label: 'fixture-tested', Body: PeopleSearch },
  ];
  return (
    <Tile as="section" labelledBy={titleId} className={s.card} data-kit-connect="">
      <Fold summary={t('kit-connect.title')} className={k.fold} summaryId={titleId} summaryClassName={k.summary}>
        <ul className={k.list}>
          {parts.map((part) => {
            const expanded = open === part.id;
            const Body = part.Body;
            return (
              <li key={part.id} className={k.item} data-kit-part={part.id}>
                <div className={k.itemHead}>
                  <button type="button" className={k.open} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : part.id)}>
                    <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={16} />
                    <span>{part.title}</span>
                  </button>
                  {part.label === 'fixture-tested' ? <span className={k.small}>{t('web-people.fixture')}</span> : <ConnectorLabel label={part.label} />}
                </div>
                {expanded && <Body />}
              </li>
            );
          })}
        </ul>
      </Fold>
    </Tile>
  );
}
