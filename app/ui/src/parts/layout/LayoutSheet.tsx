/**
 * W6 6H3 (D40): the Arrange sheet (?sheet=layout:<place>). Every block of the place in the order the page draws it:
 * blocks that always show say why and have no controls; the others can be shown or hidden, moved up or down among the
 * blocks that move, and renamed (a block with figures only to one of its listed names). Saved views: save the current
 * arrangement by name, use one, delete one. Reset puts back the library's own layout. Each change answers with the
 * engine's line and Undo; a refusal is said in the engine's words. The sheet changes the layout only: settings,
 * approvals and limits stay where they are.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { EngineError, type LayoutBlockView, type LayoutChange, type LayoutPlace, type LayoutRequest } from '../../engine/types';
import type { SheetComponentProps } from '../../shell/sheets';
import { Button } from '../Button';
import { Field } from '../Field';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';
import { useLayout } from './useLayout';
import s from './Layout.module.css';

const PLACES: readonly LayoutPlace[] = ['today', 'money'];
const isPlace = (id: string): id is LayoutPlace => (PLACES as readonly string[]).includes(id);

export function LayoutSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  if (!isPlace(id)) return <Sheet label={t('layout.sheet.label')} title={t('layout.arrange')} onClose={onClose} returnFocus={returnFocus}><p className={s.quiet}>{t('layout.loading')}</p></Sheet>;
  return <Arrange place={id} onClose={onClose} returnFocus={returnFocus} />;
}

function Arrange({ place, onClose, returnFocus }: { place: LayoutPlace; onClose: () => void; returnFocus: () => void }) {
  const t = useT();
  const client = useEngine();
  const layout = useLayout(place);
  const [said, setSaid] = useState<{ line: string; undo: LayoutRequest } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewName, setViewName] = useState('');
  const view = layout.data;
  const title = t('layout.sheet.title', { place: view?.title ?? (place === 'today' ? 'Today' : 'Money') });

  async function send(change: LayoutChange): Promise<boolean> {
    setBusy(true);
    setProblem(null);
    try {
      const result = await client.request('venture.layout.change', { place, change });
      setSaid({ line: result.line, undo: result.undo });
      return true;
    } catch (error) {
      setProblem(error instanceof EngineError || error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusy(false);
      layout.reload();
    }
  }

  const movable = (view?.blocks ?? []).filter((block) => block.movable);
  return (
    <Sheet label={t('layout.sheet.label')} title={title} line={t('layout.sheet.line')} onClose={onClose} returnFocus={returnFocus}>
      {said && (
        <p className={s.status} role="status" aria-label={t('layout.change.label')}>
          <span>{said.line}</span>
          <Button variant="quiet" size="sm" disabled={busy} onClick={() => void send(said.undo.change)}>{t('layout.undo')}</Button>
        </p>
      )}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
      {!view && !layout.error && <p className={s.quiet}>{t('layout.loading')}</p>}
      {layout.error && <p className={s.problem}>{layout.error.message}</p>}
      {view && (
        <>
          <ul className={s.list}>
            {view.blocks.map((block) => (
              <BlockRow
                key={block.id}
                block={block}
                first={movable[0]?.id === block.id}
                last={movable.at(-1)?.id === block.id}
                slot={movable.findIndex((item) => item.id === block.id)}
                busy={busy}
                send={send}
              />
            ))}
          </ul>
          <h3 className={s.section}>{t('layout.views')}</h3>
          {view.views.length === 0 ? <p className={s.quiet}>{t('layout.views.none')}</p> : (
            <ul className={s.views}>
              {view.views.map((saved) => (
                <li key={saved.id} className={s.view}>
                  <span className={s.name}>{saved.name}</span>
                  <Button variant="secondary" size="sm" disabled={busy} aria-label={t('layout.view.use', { name: saved.name })} onClick={() => void send({ op: 'use-view', view: saved.id })}>{t('layout.view.use.short')}</Button>
                  <Button variant="quiet" size="sm" disabled={busy} aria-label={t('layout.view.delete', { name: saved.name })} onClick={() => void send({ op: 'delete-view', view: saved.id })}>{t('layout.view.delete.short')}</Button>
                </li>
              ))}
            </ul>
          )}
          <div className={s.rename}>
            <Field label={t('layout.view.name')} value={viewName} maxLength={24} onChange={(event) => setViewName(event.currentTarget.value)} />
            <Button variant="secondary" disabled={busy} onClick={async () => { if (await send({ op: 'save-view', name: viewName })) setViewName(''); }}>{t('layout.view.save')}</Button>
          </div>
          {view.custom && (
            <div className={s.foot}>
              <Button variant="quiet" disabled={busy} onClick={() => void send({ op: 'reset' })}>{t('layout.reset')}</Button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}

interface BlockRowProps {
  block: LayoutBlockView;
  first: boolean;
  last: boolean;
  /** Its slot among the blocks that move, or -1. */
  slot: number;
  busy: boolean;
  send: (change: LayoutChange) => Promise<boolean>;
}

function BlockRow({ block, first, last, slot, busy, send }: BlockRowProps) {
  const t = useT();
  const [name, setName] = useState(block.name);
  /** C4 task 6: the name is text with a pencil; its field opens for this part only, while the owner renames it. */
  const [editing, setEditing] = useState(false);
  const pencil = useRef<HTMLButtonElement>(null);
  // The name the engine holds now (after a rename, an Undo or the AI's change).
  useEffect(() => { setName(block.name); }, [block.name]);
  const close = () => { setEditing(false); setName(block.name); requestAnimationFrame(() => pencil.current?.focus()); };
  async function rename(next: string) {
    if (await send({ op: 'rename', block: block.id, name: next.trim() === block.defaultName ? null : next })) { setEditing(false); requestAnimationFrame(() => pencil.current?.focus()); }
  }
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); void rename(name); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  };
  return (
    <li className={s.item} aria-label={block.name}>
      <div className={s.head}>
        <span className={s.name}>{block.name}</span>
        {block.rename !== 'fixed' && !editing && (
          <Button ref={pencil} variant="quiet" size="sm" disabled={busy} aria-label={t('layout.renamePart', { name: block.name })} onClick={() => setEditing(true)}>
            <Icon name="pencil" size={14} />
          </Button>
        )}
        {!block.shown && <span className={s.hiddenMark}>{t('layout.hidden')}</span>}
        {block.movable && (
          <>
            {!first && <Button variant="quiet" size="sm" disabled={busy} aria-label={t('layout.up', { name: block.name })} onClick={() => void send({ op: 'move', block: block.id, to: slot - 1 })}><span className={s.flip}><Icon name="chevron-down" size={16} /></span></Button>}
            {!last && <Button variant="quiet" size="sm" disabled={busy} aria-label={t('layout.down', { name: block.name })} onClick={() => void send({ op: 'move', block: block.id, to: slot + 1 })}><Icon name="chevron-down" size={16} /></Button>}
            <Button
              variant="secondary" size="sm" disabled={busy}
              aria-label={block.shown ? t('layout.hide', { name: block.name }) : t('layout.show', { name: block.name })}
              onClick={() => void send({ op: block.shown ? 'hide' : 'show', block: block.id })}
            >
              {block.shown ? t('layout.hide.short') : t('layout.show.short')}
            </Button>
          </>
        )}
      </div>
      {block.why && <p className={s.why}>{block.why}</p>}
      {editing && block.rename === 'free' && (
        <div className={s.rename}>
          <Field label={t('layout.name', { name: block.defaultName })} value={name} maxLength={32} autoFocus onKeyDown={keys} onChange={(event) => setName(event.currentTarget.value)} />
          <Button variant="quiet" disabled={busy} onClick={() => void rename(name)}>{t('layout.rename')}</Button>
        </div>
      )}
      {editing && block.rename === 'aliases' && (
        <div className={s.rename}>
          <label className={s.selectLabel}>
            {t('layout.name', { name: block.defaultName })}
            <select className={s.select} value={name} autoFocus onKeyDown={keys} onChange={(event) => setName(event.currentTarget.value)}>
              {[block.defaultName, ...block.aliases].map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <Button variant="quiet" disabled={busy} onClick={() => void rename(name)}>{t('layout.rename')}</Button>
        </div>
      )}
    </li>
  );
}
