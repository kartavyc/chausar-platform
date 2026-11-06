/**
 * C2 task 6: what the command bar shows for the words typed. Pages and actions are matched at once in the browser
 * (catalogue.ts); records come from venture.find through the shared read store, from two characters, once the owner
 * has stopped typing for 120 ms. The last answer stays on screen until the next one lands, so rows change in place and
 * never flash. Groups come in score order across records and pages, at most five rows each, with a "{count} more" line
 * that opens the place; actions follow what was found; the Ask row comes last, or first when the words read as a
 * question (F3: they end with "?" or hold four or more words).
 */

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useResource } from '../../engine/context';
import type { FindHit, FindItem, FindKind, VentureRunEvent } from '../../engine/types';
import { useT } from '../../text';
import { wordsOf } from '../../../../../platform/runtime/venture/views/find-core';
import { useNeedsYou } from '../needsYou';
import { catalogue, findInCatalogue, type CatalogueEntry } from './catalogue';

/** How long the words must rest before the engine is asked. */
export const FIND_WAIT_MS = 120;
const ROWS = 5;

/** Where each kind's "{count} more" line goes: the place that lists them all. */
const MORE_HREF: Readonly<Record<FindKind, string>> = {
  client: '#/clients', invoice: '#/money/invoices', order: '#/work', run: '#/work', chat: '#/chats',
};

/** A found thing reads again when the queue changes, Chausar answers, or a run moves. */
const FIND_EVENTS = (event: VentureRunEvent) => event.type === 'queue.changed' || event.type === 'chief.message' || event.type.startsWith('run.');

export type FindRow =
  | { id: string; kind: 'record'; href: string; item: FindItem }
  | { id: string; kind: 'entry'; href: string | null; entry: CatalogueEntry; label: string; hit: FindHit | null }
  | { id: string; kind: 'more'; href: string; group: FindKind; count: number }
  | { id: string; kind: 'ask'; words: string };

export interface FindRowGroup {
  /** A record kind, or 'page' or 'action'. */
  id: FindKind | 'page' | 'action';
  rows: FindRow[];
}

export interface FindAnswer {
  groups: FindRowGroup[];
  /** The Ask row, while there are words; null with none. */
  ask: Extract<FindRow, { kind: 'ask' }> | null;
  /** F3: the words read as a question, so the Ask row comes first. */
  askFirst: boolean;
  /** The engine refused the find (pages, actions and Ask still show). */
  failed: boolean;
  /** The open business's country, for counts in its own grouping. */
  country: string;
}

/** Where choosing a found record goes; each opens the record's own sheet or place. */
export function hrefOf(item: FindItem): string {
  const id = encodeURIComponent(item.id);
  switch (item.kind) {
    case 'client': return `#/clients?sheet=client:${item.id}`;
    case 'invoice': return `#/money/invoices?sheet=invoice:${item.id}`;
    case 'order': return `#/work?order=${id}`;
    case 'run': return `#/work?sheet=run:${item.id}`;
    case 'chat': return `#/chats?thread=${id}`;
  }
}

/** F3: words that end with a question mark, or hold four or more words, read as a question. */
export function readsAsQuestion(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.endsWith('?') || trimmed.split(/\s+/).filter(Boolean).length >= 4;
}

function useResting(text: string, ms: number): string {
  const [rested, setRested] = useState(text);
  useEffect(() => {
    if (text === rested) return;
    const timer = setTimeout(() => setRested(text), ms);
    return () => clearTimeout(timer);
  }, [text, rested, ms]);
  return rested;
}

export function useFind(text: string): FindAnswer {
  const t = useT();
  const words = useDeferredValue(text);
  const rested = useResting(words, FIND_WAIT_MS);
  const asking = wordsOf(rested).length > 0;
  const found = useResource('venture.find', { text: rested }, { skip: !asking, refreshOn: FIND_EVENTS });
  const needsYou = useNeedsYou().count;
  const venture = useResource('venture.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const businessOpen = Boolean(venture.data);
  const caFirm = venture.data?.playbook?.id === 'ca-firm';
  const country = venture.data?.venture.country?.code ?? 'IN';

  return useMemo(() => {
    const trimmed = words.trim();
    if (!trimmed) return { groups: [], ask: null, askFirst: false, failed: false, country };
    const scored: { group: FindRowGroup; best: number }[] = [];
    const typed = wordsOf(words).length > 0;
    // The engine's last answer stays until the next lands; it is dropped only once the words are too short to ask.
    if (typed && found.data) {
      for (const group of found.data.groups) {
        const rows: FindRow[] = group.items.slice(0, ROWS).map((item) => ({ id: `${item.kind}:${item.id}`, kind: 'record', href: hrefOf(item), item }));
        if (group.more > 0) rows.push({ id: `more:${group.kind}`, kind: 'more', href: MORE_HREF[group.kind], group: group.kind, count: group.more });
        scored.push({ group: { id: group.kind, rows }, best: group.best });
      }
    }
    const entries = typed ? findInCatalogue(words, catalogue({ businessOpen, needsYou, caFirm }), t) : [];
    const pages = entries.filter((hit) => hit.entry.kind === 'page').slice(0, ROWS);
    const actions = entries.filter((hit) => hit.entry.kind === 'action').slice(0, ROWS);
    const asRow = (hit: (typeof entries)[number]): FindRow => ({ id: hit.entry.id, kind: 'entry', href: hit.entry.href, entry: hit.entry, label: hit.label, hit: hit.hit });
    if (pages.length) scored.push({ group: { id: 'page', rows: pages.map(asRow) }, best: pages[0]!.score });
    const groups = scored.sort((a, b) => b.best - a.best).map((item) => item.group);
    if (actions.length) groups.push({ id: 'action', rows: actions.map(asRow) });
    return { groups, ask: { id: 'ask', kind: 'ask', words: trimmed }, askFirst: readsAsQuestion(trimmed), failed: Boolean(found.error) && typed, country };
  }, [words, found.data, found.error, businessOpen, needsYou, caFirm, country, t]);
}
