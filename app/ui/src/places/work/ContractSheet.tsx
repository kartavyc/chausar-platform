import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useT, type T } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Tile, TileHead } from '../../parts/Tile';
import { stateText } from '../../parts/states';
import type { OrderContractView } from '../../engine/types';
import s from './Work.module.css';
import c from './ContractSheet.module.css';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** One item's state (open, done, skipped), or open when the engine sent no marks yet. */
function stateOf(view: OrderContractView, id: string): string {
  return view.items?.find((item) => item.id === id)?.state ?? 'open';
}

function Part({ id, title, items }: { id: string; title: string; items: ReactNode[] }) {
  if (items.length === 0) return null;
  return (
    <section className={c.part} data-part={id} aria-label={title}>
      <h3 className={c.small}>{title}</h3>
      <ul className={c.list}>{items.map((item, i) => <li key={i}>{item}</li>)}</ul>
    </section>
  );
}

/** What the contract covers, in the owner's or the agent's own words (quoted content), with each item's state. */
function Covers({ view, t }: { view: OrderContractView; t: T }) {
  const { contract } = view;
  return (
    <div className={c.covers} data-content="">
      <Part id="scope" title={t('work.contract.scope')} items={contract.scope} />
      <Part id="constraints" title={t('work.contract.constraints')} items={contract.constraints} />
      <Part id="protected" title={t('work.contract.protected')} items={contract.protected.map((item) => t(item.kind === 'file' ? 'work.contract.file' : 'work.contract.phrase', { value: item.value }))} />
      <Part
        id="deliverables" title={t('work.contract.deliverables')}
        items={contract.deliverables.map((item) => t('work.contract.item', { word: stateText(t, 'contractItem', stateOf(view, item.id)), what: t('work.contract.doneWhen', { what: item.what, when: item.doneWhen }) }))}
      />
      <Part id="checks" title={t('work.contract.checks')} items={contract.checks.map((item) => t('work.contract.item', { word: stateText(t, 'contractItem', stateOf(view, item.id)), what: item.what }))} />
    </div>
  );
}

/**
 * The order's contract on a Work order (W4 4J22a, from 4J12's venture.order.contract; catalogue H24): its goal, the
 * engine's line on where it stands, and what it covers (scope, limits, what is kept as it is, what it delivers and its
 * checks, each with its state). Unsigned, all of it shows and Sign asks a second time before it signs the revision read,
 * by its digest; signed, what it covers folds one step away. An order with no contract shows nothing: in wave 4 no
 * shipped offer needs one, and writing one is not on this screen.
 */
export function ContractSheet({ orderId }: { orderId: string }) {
  const t = useT();
  const client = useEngine();
  const headingId = useId();
  const contract = useResource('venture.order.contract', { orderId }, { refreshOn: (event) => event.type === 'queue.changed' });
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (asking) cancelRef.current?.focus(); }, [asking]);

  const view = contract.data;
  if (!view) return null;

  async function sign(seen: OrderContractView) {
    setBusy(true);
    setProblem(null);
    try {
      await client.request('venture.order.contract.sign', { orderId, digest: seen.digest });
    } catch (error) {
      setProblem(t('work.contract.failed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
      setAsking(false);
      contract.reload();
    }
  }

  const signed = view.signed !== null;
  return (
    <Tile as="section" labelledBy={headingId} className={c.tile}>
      <TileHead id={headingId} title={t('work.contract.title')} />
      <p className={c.goal} data-content=""><span data-goal="">{view.contract.goal}</span></p>
      <p className={s.note} data-contract-line="">{view.line}</p>
      {signed ? (
        <details className={c.fold} data-fold="contract">
          <summary>{t('work.contract.more')}</summary>
          <Covers view={view} t={t} />
        </details>
      ) : <Covers view={view} t={t} />}
      {!signed && (asking ? (
        <div className={c.ask} data-second-ask="">
          <p className={s.note}>{t('work.contract.signAsk', { n: view.revision })}</p>
          <div className={s.act}>
            <Button ref={cancelRef} variant="quiet" disabled={busy} onClick={() => setAsking(false)}>{t('approval.cancel')}</Button>
            <Button variant="primary" disabled={busy} aria-busy={busy || undefined} onClick={() => void sign(view)}>{t('work.contract.signRevision', { n: view.revision })}</Button>
          </div>
        </div>
      ) : (
        <div className={s.act}>
          <Button variant="primary" onClick={() => { setProblem(null); setAsking(true); }}>{t('work.contract.sign')}</Button>
        </div>
      ))}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </Tile>
  );
}
