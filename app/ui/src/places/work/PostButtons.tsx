import { useEffect, useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Tile, TileHead } from '../../parts/Tile';
import type { ConnectorCardLite, DeliveryLite, DraftPostLite, PostingProposal } from '../../engine/types';
import { answerOf } from './ShareLinks';
import s from './Work.module.css';

const never = () => false;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** The connectors whose text posts Chausar can make from the owner's own browser (build/posting.ts). */
const TEXT_POSTING = new Set(['linkedin', 'x', 'bluesky', 'mastodon', 'telegram', 'discord']);

/** Whether the engine says this connector can post now, in any way it lists. */
function canPost(cards: readonly ConnectorCardLite[], connectorId: string): boolean {
  return cards.some((card) => card.id === connectorId && card.postingOptions.some((option) => option.status === 'available'));
}

/**
 * Posting an approved draft (Ink v2 wave 2, K1): for each draft the owner accepted or edited, and the client approved
 * where the engine says the client must (the answer the engine counts), one line per LinkedIn or X post the engine says
 * it can post now, with "Post to LinkedIn". The button only proposes (venture.posting.propose, by the post's id, never
 * its text): the post then waits on Today for the owner's approval, with the risk gate's warnings in the engine's
 * words. A refusal is shown in the engine's words. Nothing here decides whether a post may go. version: raised when
 * the owner records a client's answer, so the lines read the engine again at once.
 */
export function PostButtons({ drafts, version = 0 }: { drafts: DeliveryLite[]; version?: number }) {
  const t = useT();
  const headingId = useId();
  const cards = useResource('venture.connectors.list', {}, {refreshOn:event=>event.type==='desk.changed'});
  const accepted = drafts.filter((draft) => !draft.practice && (draft.status === 'accepted' || draft.status === 'edited'));
  if (accepted.length === 0) return null;
  return (
    <>
      {accepted.map((draft) => <DraftPosts key={draft.id} draft={draft} cards={cards.data ?? []} headingId={headingId} heading={t('work.post.heading')} version={version} />)}
    </>
  );
}

function DraftPosts({ draft, cards, headingId, heading, version }: { draft: DeliveryLite; cards: readonly ConnectorCardLite[]; headingId: string; heading: string; version: number }) {
  const shared = useResource('venture.share.list', { deliveryId: draft.id }, { refreshOn: never });
  const reload = shared.reload;
  useEffect(() => { if (version > 0) reload(); }, [version, reload]);
  const answer = answerOf(shared.data);
  const posts = (shared.data?.posts ?? []).filter((post) => post.connectorId !== null && TEXT_POSTING.has(post.connectorId) && canPost(cards, post.connectorId));
  // The engine says whether the client must approve first (the social agency); when it does not say, wait for the client.
  const clientFirst = shared.data?.clientApproval !== false;
  if ((clientFirst && answer?.decision !== 'approved') || posts.length === 0) return null;
  return (
    <Tile as="section" labelledBy={`${headingId}-${draft.id}`}>
      <TileHead id={`${headingId}-${draft.id}`} title={heading} />
      <ul className={s.list}>
        {posts.map((post) => <PostLine key={post.draftId} post={post} />)}
      </ul>
    </Tile>
  );
}

function PostLine({ post }: { post: DraftPostLite }) {
  const t = useT();
  const client = useEngine();
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<PostingProposal | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function propose() {
    setBusy(true);
    setProblem(null);
    try {
      setProposal(await client.request('venture.posting.propose', { draftId: post.draftId }));
    } catch (error) {
      setProblem(t('work.post.failed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={s.item} data-row="" data-row-id={`post-${post.draftId}`} tabIndex={-1}>
      <span className={s.who}>{post.name}</span>
      <span className={s.what}>{post.text}</span>
      <div className={s.tail}>
        {proposal ? (
          <span className={s.state} role="status">
            {t('work.post.waiting')}
            {proposal.warnings.map((warning) => <span key={warning} className={s.quiet}> {warning}</span>)}
          </span>
        ) : (
          <span className={s.act}>
            <Button variant="quiet" disabled={busy} onClick={() => void propose()}>{busy ? t('work.post.proposing') : t('work.post.button', { name: post.name })}</Button>
          </span>
        )}
      </div>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </li>
  );
}
