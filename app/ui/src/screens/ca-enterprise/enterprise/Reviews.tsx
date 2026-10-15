/**
 * Trust, Reviews (enterprise part 3, "Access: roles, grants, reviews"): each person's role,
 * branches, persona, grants and whether they administer the installation, changed with
 * `enterprise.access.set`; and access reviews: start one, keep or remove each person, and the
 * past reviews. Removing asks for the seat's removal, so the second person's agreement (dual
 * control) applies: the row then says it waits for the second person.
 */
import { useState } from 'react';
import { date } from '../../../format/dates.ts';
import { useT } from '../../../app/text';
import { Button } from '../../../parts/Button';
import { Choice } from '../../../parts/Choice';
import type { PlaceRenderProps } from '../../../places/types.ts';
import { State } from '../../../patterns/States';
import { Frame, Group, Note, Outcome, useWhere } from './Frame';
import { canChange, useRead, useSend } from './kit.ts';
import { validateAccess, validatePerson, validateReview, validateReviews, type AccessList, type Person, type Persona, type Review, type WhoseValue } from './validate.ts';
import { WhoseControl, useWhoseMembers } from './WhoseControl';
import s from './Enterprise.module.css';

/** The list id under which "Whose" is kept for the review rows. */
export const REVIEWS_LIST = 'trust.reviews';

function day(iso: string, language: PlaceRenderProps['language']): string {
  try { return date(iso.slice(0, 10), 'short', language); } catch { return iso; }
}

export function ReviewsScreen({ p }: { p: PlaceRenderProps }) {
  const t = useT();
  const where = useWhere();
  const access = useRead(p, 'enterprise.access.list', validateAccess);
  const [whose, setWhose] = useState<WhoseValue>('everyone');
  return (
    <Frame where={where('trust', 'reviews')} title={t('SH-01.sub.trust.reviews')} loaded={access.state} forbiddenKey="ENX-reviews.forbidden"
      aside={<WhoseControl rpc={p.rpc} list={REVIEWS_LIST} onChange={setWhose} />}>
      {(list) => (
        <>
          <PeopleGroup p={p} list={list} onSaved={(row) => access.replace({ ...list, people: list.people.map((x) => (x.memberId === row.memberId ? row : x)) })} />
          <ReviewsGroup p={p} whose={whose} names={new Map(list.people.map((x) => [x.memberId, x.name] as const))} />
        </>
      )}
    </Frame>
  );
}

function PeopleGroup({ p, list, onSaved }: { p: PlaceRenderProps; list: AccessList; onSaved: (row: Person) => void }) {
  const t = useT();
  return (
    <Group title={t('ENX-access.people')} note={t('ENX-access.intro')}>
      {list.people.length === 0 ? <Note>{t('ENX-access.none')}</Note> : (
        <ul className={s.list}>
          {list.people.map((person) => <PersonRow key={person.memberId} p={p} person={person} list={list} onSaved={onSaved} />)}
        </ul>
      )}
    </Group>
  );
}

function PersonRow({ p, person, list, onSaved }: { p: PlaceRenderProps; person: Person; list: AccessList; onSaved: (row: Person) => void }) {
  const t = useT();
  const edit = canChange(p);
  const [persona, setPersona] = useState<Persona | 'none'>(person.persona ?? 'none');
  const [all, setAll] = useState(person.grants === null);
  const [grants, setGrants] = useState<readonly string[]>(person.grants ?? []);
  const [administers, setAdministers] = useState(person.administers);
  const { sent, send } = useSend(p.rpc, validatePerson);
  const save = async () => {
    const payload = {
      memberId: person.memberId, persona: persona === 'none' ? null : persona,
      grants: all ? null : list.grantable.filter((g) => grants.includes(g)), administers,
    };
    const done = await send('enterprise.access.set', payload);
    if (done !== null && p.live(p.address)) onSaved(done);
  };
  const busy = sent.kind === 'sending';
  const grantWords = person.grants === null ? t('ENX-access.grants.all') : person.grants.length === 0 ? t('ENX-access.grants.none') : person.grants.join(', ');
  return (
    <li className={s.item} data-member={person.memberId}>
      <span className={s.itemHead}>
        <span className={s.name}>{person.name}</span>
        <span>{person.role}</span>
        {!person.active && <span className={s.label}>{t('ENX-access.inactive')}</span>}
        {person.administers && <span className={s.label}>{t('ENX-access.administers')}</span>}
      </span>
      <span className={s.note}>{person.branches.length === 0 ? t('ENX-access.branches.none') : t('ENX-access.branches', { list: person.branches.join(', ') })}</span>
      {!edit ? (
        <>
          <span className={s.note}>{person.persona === null ? t('ENX-access.persona.none') : t('ENX-access.persona.is', { persona: t(`ENX-persona.${person.persona}`) })}</span>
          <span className={s.note}>{t('ENX-access.grants.is', { list: grantWords })}</span>
        </>
      ) : (
        <>
          <Choice<Persona | 'none'> label={t('ENX-access.persona')} value={persona} onChange={setPersona} disabled={busy}
            options={[...list.personas.map((x) => ({ value: x, label: t(`ENX-persona.${x}`) })), { value: 'none' as const, label: t('ENX-persona.none') }]} />
          <fieldset className={s.checks}>
            <legend>{t('ENX-access.grants')}</legend>
            <label className={s.check}>
              <input type="checkbox" checked={all} disabled={busy} onChange={(e) => setAll(e.currentTarget.checked)} />
              {t('ENX-access.grants.allBox')}
            </label>
            {!all && list.grantable.map((g) => (
              <label key={g} className={s.check}>
                <input type="checkbox" checked={grants.includes(g)} disabled={busy}
                  onChange={(e) => { const on = e.currentTarget.checked; setGrants((cur) => (on ? [...cur.filter((x) => x !== g), g] : cur.filter((x) => x !== g))); }} />
                <span className={s.mono}>{g}</span>
              </label>
            ))}
          </fieldset>
          <label className={s.check}>
            <input type="checkbox" checked={administers} disabled={busy} onChange={(e) => setAdministers(e.currentTarget.checked)} />
            {t('ENX-access.administersBox')}
          </label>
          <span><Button onClick={() => void save()} disabled={busy}>{t('ENX-access.save', { name: person.name })}</Button></span>
          <Outcome sent={sent} />
        </>
      )}
    </li>
  );
}

function ReviewsGroup({ p, whose, names }: { p: PlaceRenderProps; whose: WhoseValue; names: ReadonlyMap<string, string> }) {
  const t = useT();
  const reviews = useRead(p, 'enterprise.access.reviews', validateReviews);
  const start = useSend(p.rpc, validateReview);
  const edit = canChange(p);
  const members = useWhoseMembers(p.rpc, whose, p.member.id);
  const shown = (r: Review): Review => (members === null ? r : { ...r, rows: r.rows.filter((row) => row.decidedBy !== null && members.has(row.decidedBy)) });
  const put = (review: Review) => {
    if (reviews.state.kind !== 'ready') { reviews.reload(); return; }
    const others = reviews.state.value.reviews.filter((r) => r.reviewId !== review.reviewId);
    reviews.replace({ reviews: [review, ...others] });
  };
  const begin = async () => { const done = await start.send('enterprise.access.review.start', {}); if (done !== null && p.live(p.address)) put(done); };
  if (reviews.state.kind !== 'ready') {
    return <Group title={t('ENX-reviews.title')}><State state={reviews.state.kind === 'failed' ? { kind: 'failed', code: reviews.state.code } : { kind: reviews.state.kind }} /></Group>;
  }
  const open = reviews.state.value.reviews.find((r) => r.closedAt === null) ?? null;
  const past = reviews.state.value.reviews.filter((r) => r.closedAt !== null);
  return (
    <>
      <Group title={t('ENX-reviews.title')} note={t('ENX-reviews.intro')}>
        {open === null ? (
          <>
            <Note>{t('ENX-reviews.noneOpen')}</Note>
            {edit && <span><Button onClick={() => void begin()} disabled={start.sent.kind === 'sending'}>{t('ENX-reviews.start')}</Button></span>}
            <Outcome sent={start.sent} done={() => null} />
          </>
        ) : (
          <OpenReview p={p} review={shown(open)} edit={edit} onReview={put} names={names} />
        )}
      </Group>
      <Group title={t('ENX-reviews.past')}>
        {past.length === 0 ? <Note>{t('ENX-reviews.pastNone')}</Note> : (
          <ul className={s.list}>
            {past.map((r) => {
              const v = shown(r);
              return (
                <li key={r.reviewId} className={s.item} data-review={r.reviewId}>
                  <span>{t('ENX-reviews.pastLine', { started: day(r.startedAt, p.language), closed: day(r.closedAt ?? r.startedAt, p.language) })}</span>
                  <span className={s.note}>{t('ENX-reviews.pastCounts', {
                    kept: String(v.rows.filter((x) => x.decision === 'keep').length), removed: String(v.rows.filter((x) => x.decision === 'remove').length),
                  })}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Group>
    </>
  );
}

function OpenReview({ p, review, edit, onReview, names }: { p: PlaceRenderProps; review: Review; edit: boolean; onReview: (r: Review) => void; names: ReadonlyMap<string, string> }) {
  const t = useT();
  const { sent, send } = useSend(p.rpc, validateReview);
  const decide = async (memberId: string, keep: boolean) => {
    const done = await send('enterprise.access.review.decide', { reviewId: review.reviewId, memberId, keep });
    if (done !== null && p.live(p.address)) onReview(done);
  };
  return (
    <>
      <p className={s.text}>{t('ENX-reviews.openSince', { date: day(review.startedAt, p.language) })}</p>
      {review.rows.length === 0 ? <Note>{t('ENX-reviews.rowsNone')}</Note> : (
        <ul className={s.list}>
          {review.rows.map((row) => (
            <li key={row.memberId} className={s.item} data-row={row.memberId}>
              <span className={s.itemHead}><span className={s.name}>{row.name}</span><span>{row.role}</span></span>
              {row.decision === null ? (
                edit ? (
                  <span className={s.line}>
                    <Button onClick={() => void decide(row.memberId, true)} disabled={sent.kind === 'sending'}>{t('ENX-reviews.keep', { name: row.name })}</Button>
                    <Button danger onClick={() => void decide(row.memberId, false)} disabled={sent.kind === 'sending'}>{t('ENX-reviews.remove', { name: row.name })}</Button>
                  </span>
                ) : <span className={s.note}>{t('ENX-reviews.undecided')}</span>
              ) : (
                <span className={s.note}>
                  {t(row.decision === 'keep' ? 'ENX-reviews.kept' : 'ENX-reviews.removed', { by: row.decidedBy === null ? t('ENX-value.unknown') : names.get(row.decidedBy) ?? row.decidedBy })}
                </span>
              )}
              {row.decision === 'remove' && row.changeId !== null && <span className={s.status} role="status">{t('ENX-reviews.waitsSecond')}</span>}
            </li>
          ))}
        </ul>
      )}
      <Outcome sent={sent} done={() => null} />
    </>
  );
}
