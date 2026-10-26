/**
 * A network result's drafting buttons (D-Network's `.r-acts`; 4D4 left them to 4E4): WhatsApp and Draft intro (or Draft
 * a note, when the owner knows them directly or has no confirmed connector). Each puts the person on the pipeline first
 * when they are not on it (venture.pipeline.add, with this search as what found them), then asks the engine for the
 * draft (venture.outreach.draft): an intro request through the confirmed connector, or a note. The draft sheet then
 * shows it, and the owner sends it from their own app: WhatsApp is a wa.me handoff only, and Chausar never sends. A
 * note to someone the owner does not know yet opens the card, where its lawful basis and footer are chosen.
 */

import { useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { Button } from '../../parts/Button';
import { Icon } from '../../parts/Icon';
import type { OutreachChannel, PipelineStage, SearchResultView } from '../../engine/types';
import { NeverContactLost } from './NeverContactLost';
import { codeOf, messageOf } from './network';
import { clientsChanged } from './signals';
import { draftSheetId } from './handoff';
import s from './Pipeline.module.css';

const WARM = new Set(['close', 'know-well', 'know']);
const firstOf = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export function NetworkDrafts({ result, searchId, stage, onStage }: { result: SearchResultView; searchId: string; stage: PipelineStage | null; onStage: (stage: PipelineStage) => void }) {
  const t = useT();
  const engine = useEngine();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ code: string; message: string } | null>(null);
  const person = result.person;
  if (!person) return null;
  const via = result.path?.via && result.path.confirmed ? result.path.via : null;
  const warm = Boolean(person.band && WARM.has(person.band));
  // WhatsApp only to someone the owner knows: the connector, or the person when known well (the engine refuses a cold one).
  const whatsapp = via ? firstOf(via.name) : warm ? firstOf(person.name) : null;

  /** The person's card: the one they have, or a new one at Found with this search as what found them. */
  async function cardId(): Promise<string> {
    if (!stage) {
      const { card } = await engine.request('venture.pipeline.add', { personId: person!.id, trigger: { kind: 'search', ref: searchId } });
      onStage(card.stage);
      clientsChanged(engine);
      return card.id;
    }
    const { card } = await engine.request('venture.network.person', { id: person!.id });
    if (!card) throw new Error(t('clients.outreach.noCard'));
    return card.id;
  }

  async function draft(channel: OutreachChannel) {
    setBusy(true);
    setProblem(null);
    let id: string | null = null;
    try {
      id = await cardId();
      if (!via && !warm) { openSheet('card', id); return; }
      const { draft: view } = await engine.request('venture.outreach.draft', { opportunityId: id, kind: via ? 'intro-request' : 'follow-up', channel });
      clientsChanged(engine);
      openSheet('outreach', draftSheetId(person!.id, view.id));
    } catch (error) {
      setProblem({ code: codeOf(error), message: messageOf(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {whatsapp && <Button disabled={busy} onClick={() => void draft('whatsapp')}><Icon name="message-square" size={16} />{t('clients.outreach.whatsappName', { name: whatsapp })}</Button>}
      <Button variant="primary" disabled={busy} onClick={() => void draft('email')}><Icon name="file-pen" size={16} />{via ? t('clients.outreach.draftIntro') : t('clients.outreach.draftNote')}</Button>
      {problem && (problem.code === 'NEVER_CONTACT_LOST' ? <NeverContactLost /> : <p className={s.problem} role="alert">{problem.message}</p>)}
    </>
  );
}
