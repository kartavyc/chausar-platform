import {playbookLabel} from '../../text/playbook-label';
/**
 * The business's own desk on Work, beside its orders (Ink v2 wave 5, package 5A1): the open business's playbook (the one
 * its idea picks, from venture.get) finds its desk in DESKS (places/work/desks/index.ts). A desk shows only once its
 * package marks it ready (`<Id>Desk.ready = true` in its own <Id>Desk.tsx), so no business shows a stub that says
 * "Not built yet". A business no playbook serves has no desk.
 */

import { useId, useState, type ComponentType } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import type { DeskPlaybook } from '../../engine/types';
import { SectionHead } from '../../parts/Tile';
import { DESKS } from './desks';
import s from './Work.module.css';

/** A desk component its package marked ready to show. */
type ReadyDesk = ComponentType & { ready?: boolean };

/** Whether a playbook has a desk its package marked ready. */
export function deskReady(playbook: string | undefined): playbook is DeskPlaybook {
  return !!playbook && Object.hasOwn(DESKS, playbook) && (DESKS[playbook as DeskPlaybook] as ReadyDesk).ready === true;
}

/** The open business's desk under its own head, or nothing while its playbook has no ready desk. */
export function PlaybookDesk() {
  const t = useT();
  const id = useId();
  const linked = new URLSearchParams(window.location.hash.split('?')[1] ?? '').has('socialOrder');
  const [opened, setOpened] = useState(linked);
  const venture = useResource('venture.get', {}, { refreshOn: (event) => event.type === 'desk.changed' || event.type === 'queue.changed' });
  const pick = venture.data?.playbook;
  if (!deskReady(pick?.id)) return null;
  const Desk = DESKS[pick!.id as DeskPlaybook];
  return (
    <section aria-labelledby={id} className={s.block} data-desk={pick!.id}>
      <SectionHead id={id} title={t('kit-chain.desk')} meta={playbookLabel(t,pick)} />
<details className={s.whyMore} open={linked || undefined} onToggle={event => { if (event.currentTarget.open) setOpened(true); }}><summary>{t('kit-chain.openTools')}</summary>{opened && <Desk />}</details>
    </section>
  );
}
