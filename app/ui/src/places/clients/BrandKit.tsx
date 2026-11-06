/**
 * The client's brand kit on the client sheet (Ink v2 wave 5, package 5A4; catalogue P7). Simple first: the kit every
 * creative step reads, field by field, each with where it came from when that is not the client (your own voice,
 * Chausar's house style), and the client's past briefs. One step away, Edit sets a new version (venture.brandKit.set,
 * the owner's approval inside the app); Undo sets the version before. Colours show as their codes: a swatch would need
 * an inline style. Claims and their proof files are kept as they are when the kit is edited here. Written for Chausar.
 */

import { useId, useState, type FormEvent } from 'react';
import { useT, type T } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { EngineError, type BrandKitFields, type BrandKitInput, type BrandKitView, type KitSource, type UploadLite } from '../../engine/types';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import k from './BrandKit.module.css';

/** The list fields the form edits as text, in the order shown. */
const LISTS = ['colours', 'fonts', 'voice', 'bannedWords', 'bannedTopics', 'competitors'] as const;
type ListField = (typeof LISTS)[number];
/** Fields typed one per line; the rest are separated by commas. */
const BY_LINE: readonly ListField[] = ['voice'];
/** The engine codes this sheet words itself, in both languages. */
const WORDED = new Set(['CHAT_KEY_REFUSED', 'APP_APPROVAL_REQUIRED', 'UPLOAD_NOT_FOUND', 'CLIENT_NOT_FOUND']);

function wordsOf(error: unknown, t: T): string {
  if (error instanceof EngineError && WORDED.has(error.code)) return t(`kit-media.error.${error.code}`);
  return error instanceof Error ? error.message : String(error);
}

const split = (field: ListField, value: string) => value.split(BY_LINE.includes(field) ? /\n/ : /[,\n]/).map((item) => item.trim()).filter(Boolean);
const join = (field: ListField, items: readonly string[]) => items.join(BY_LINE.includes(field) ? '\n' : ', ');

type Draft = Record<ListField, string> & { samples: [string, string, string]; logoFileId: string };
function draftOf(kit: BrandKitFields | null): Draft {
  const samples = kit?.samples ?? [];
  return {
    ...(Object.fromEntries(LISTS.map((field) => [field, join(field, kit?.[field] ?? [])])) as Record<ListField, string>),
    samples: [samples[0] ?? '', samples[1] ?? '', samples[2] ?? ''], logoFileId: kit?.logoFileId ?? '',
  };
}

export function BrandKit({ clientId, files }: { clientId: string; files: readonly UploadLite[] }) {
  const t = useT();
  const engine = useEngine();
  const headingId = useId();
  const view = useResource('venture.brandKit.get', { clientId });
  const [shown, setShown] = useState<BrandKitView | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const kit = shown ?? view.data ?? null;
  if (!kit) return null;
  const photos = files.filter((file) => file.format === 'image');

  async function save(input: BrandKitInput) {
    setBusy(true);
    setProblem(null);
    try {
      setShown(await engine.request('venture.brandKit.set', { clientId, kit: input }));
      setEditing(false);
    } catch (error) {
      setProblem(t('kit-media.kit.failed', { message: wordsOf(error, t) }));
    } finally {
      setBusy(false);
    }
  }

  const filled = (Object.keys(kit.resolved) as (keyof BrandKitFields)[]).filter((field) => {
    const value = kit.resolved[field].value;
    return field !== 'logoFileId' && field !== 'claims' && Array.isArray(value) && value.length > 0;
  });
  const logo = kit.resolved.logoFileId.value ? files.find((file) => file.id === kit.resolved.logoFileId.value)?.name ?? null : null;

  return (
    <section aria-labelledby={headingId} className={k.kit} data-brand-kit="">
      <h3 id={headingId} className={k.heading}>{t('kit-media.kit.heading')}</h3>
      <p className={k.line}>{kit.version === null ? t('kit-media.kit.none') : t('kit-media.kit.version', { version: kit.version })}</p>
      {!editing && (
        <>
          {(filled.length > 0 || logo) && (
            <dl className={k.fields}>
              {filled.map((field) => (
                <div key={field} className={k.field}>
                  <dt className={k.label}>{t(`kit-media.field.${field}`)}</dt>
                  <dd className={k.value}>
                    <span className={field === 'colours' ? 'mono' : undefined} data-content="">{(kit.resolved[field].value as string[]).join(field === 'samples' ? ' / ' : ', ')}</span>
                    {kit.resolved[field].source !== 'client-kit' && <span className={k.source}>{sourceWords(kit.resolved[field].source, t)}</span>}
                  </dd>
                </div>
              ))}
              {logo && (
                <div className={k.field}>
                  <dt className={k.label}>{t('kit-media.field.logoFileId')}</dt>
                  <dd className={`${k.value} mono`}>{logo}</dd>
                </div>
              )}
              {kit.resolved.claims.value.length > 0 && (
                <div className={k.field}>
                  <dt className={k.label}>{t('kit-media.field.claims')}</dt>
                  <dd className={k.value} data-content="">{kit.resolved.claims.value.map((claim) => claim.claim).join(' / ')}</dd>
                </div>
              )}
            </dl>
          )}
          {kit.memory.length > 0 && (
            <p className={k.line}>{t('kit-media.kit.memory', { count: kit.memory.length })} <span className={k.quote} data-content="">{kit.memory[0]!.request}</span></p>
          )}
          <span className={k.actions}>
            {kit.undo && <Button variant="quiet" disabled={busy} onClick={() => void save(kit.undo!)}>{t('kit-media.kit.undo')}</Button>}
            <Button variant={kit.version === null ? 'primary' : 'secondary'} disabled={busy} onClick={() => setEditing(true)}>
              {kit.version === null ? t('kit-media.kit.add') : t('kit-media.kit.edit')}
            </Button>
          </span>
        </>
      )}
      {editing && <KitForm kit={kit.kit} photos={photos} busy={busy} onSave={(input) => void save(input)} onCancel={() => setEditing(false)} />}
      {problem && <p className={k.problem} role="alert">{problem}</p>}
    </section>
  );
}

function sourceWords(source: KitSource, t: T): string {
  return t(`kit-media.source.${source}`);
}

function KitForm({ kit, photos, busy, onSave, onCancel }: { kit: BrandKitFields | null; photos: readonly UploadLite[]; busy: boolean; onSave: (input: BrandKitInput) => void; onCancel: () => void }) {
  const t = useT();
  const logoId = useId();
  const [draft, setDraft] = useState<Draft>(() => draftOf(kit));

  function submit(event: FormEvent) {
    event.preventDefault();
    const input: BrandKitInput = {
      ...(Object.fromEntries(LISTS.map((field) => [field, split(field, draft[field])])) as Record<ListField, string[]>),
      samples: draft.samples.map((sample) => sample.trim()).filter(Boolean),
      logoFileId: draft.logoFileId || null,
      claims: kit?.claims ?? [],
    };
    onSave(input);
  }

  return (
    <form className={k.form} onSubmit={submit} aria-label={t('kit-media.kit.form')}>
      {LISTS.map((field) => (
        <Field
          key={field}
          label={t(`kit-media.field.${field}`)}
          hint={t(BY_LINE.includes(field) ? 'kit-media.hint.lines' : field === 'colours' ? 'kit-media.hint.colours' : 'kit-media.hint.commas')}
          {...(BY_LINE.includes(field) ? { multiline: true as const } : {})}
          value={draft[field]}
          onChange={(event: { target: { value: string } }) => setDraft((d) => ({ ...d, [field]: event.target.value }))}
        />
      ))}
      {draft.samples.map((sample, index) => (
        <Field
          key={index}
          multiline
          label={t('kit-media.field.sample', { n: index + 1 })}
          {...(index === 0 ? { hint: t('kit-media.hint.samples') } : {})}
          value={sample}
          onChange={(event) => setDraft((d) => {
            const samples = [...d.samples] as Draft['samples'];
            samples[index] = event.target.value;
            return { ...d, samples };
          })}
        />
      ))}
      {photos.length > 0 && (
        <div className={k.pick}>
          <label htmlFor={logoId} className={k.label}>{t('kit-media.field.logoFileId')}</label>
          <select id={logoId} className={k.select} value={draft.logoFileId} onChange={(event) => setDraft((d) => ({ ...d, logoFileId: event.currentTarget.value }))}>
            <option value="">{t('kit-media.kit.noLogo')}</option>
            {photos.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}
          </select>
        </div>
      )}
      <span className={k.actions}>
        <Button type="button" variant="quiet" disabled={busy} onClick={onCancel}>{t('kit-media.kit.cancel')}</Button>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? t('kit-media.kit.saving') : t('kit-media.kit.save')}</Button>
      </span>
    </form>
  );
}
