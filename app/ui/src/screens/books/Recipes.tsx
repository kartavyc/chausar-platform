/** BK-05 Recipes: registered recipes with their state, scope, bindings, check and questions; proposed mappings from BK-06. */
import { Note, Section, Actions, Button, Refusal } from '../work/kit/Page';
import { useAct, useReply } from '../work/kit/reply.ts';
import { day, dayTime } from '../work/kit/format.ts';
import { missingWord } from '../work/kit/words.ts';
import { proposalView, recipeReply, recipesReply, type ProposalView, type RecipeView } from './contract.ts';
import { BooksPage, BooksSheet, Link, Table, fill, idOf, prepares, sheetOf, styles as s, valueOf, type BooksProps } from './shared.tsx';
import { Say, TwoTotals } from './r2-parts.tsx';
import { useR2, type R2 } from './words-r2.ts';
import { useAuditWords } from './words-audit.ts';

export function Recipes(props: BooksProps) {
  const r = useR2(props.language);
  const { loaded, reload } = useReply(props, 'books.recipes', {}, recipesReply);
  const value = valueOf(loaded);
  const open = idOf(props.address.sheet);
  return (
    <BooksPage props={props} sub="recipes" title={r['title.recipes']} count={value ? String(value.recipes.length) : undefined} loaded={loaded} reload={reload}>
      {value && (
        <>
          {!value.available && <Note>{r['say.CONNECTORS_NOT_INSTALLED']}</Note>}
          {value.available && (value.recipes.length === 0 ? <Note>{r['empty.recipes']}</Note> : (
            <Table view={props.view} caption={r['title.recipes']} columns={[
              { head: r['col.recipe'], simple: true }, { head: r['scope.system'] }, { head: r['col.state'], simple: true }, { head: r['col.lastRead'] },
            ]} rows={value.recipes.map(x => ({ key: x.id, cells: [
              <Link onPress={() => props.navigate({ place: 'books', sub: 'recipes', sheet: sheetOf(`r:${x.id}`) })}>{x.title}</Link>,
              x.system, <span className={x.state === 'failed' ? s.amber : undefined}>{r[`rstate.${x.state}`]}</span>,
              x.lastReadAt ? day(x.lastReadAt, props.language) : <span className={s.missing}>{missingWord('not-loaded-yet', props.language)}</span>,
            ] }))} />
          ))}
          <Section title={r.proposals}>
            {value.proposals.length === 0 ? <Note>{r['empty.proposals']}</Note> : (
              <ul className={s.list}>{value.proposals.map(p => (
                <li key={p.id}><Link onPress={() => props.navigate({ place: 'books', sub: 'recipes', sheet: sheetOf(`p:${p.id}`) })}>{p.field}</Link> · {p.sourceId} · {r[`pstate.${p.state}`]} · {p.proposedBy}</li>
              ))}</ul>
            )}
          </Section>
        </>
      )}
      {open?.startsWith('r:') && <RecipeSheet props={props} recipeId={open.slice(2)} proposals={value?.proposals ?? []} />}
      {open?.startsWith('p:') && <ProposalSheet props={props} id={open.slice(2)} onChanged={reload} />}
    </BooksPage>
  );
}

function scopeRows(v: RecipeView, r: R2, language: BooksProps['language']) {
  const miss = (x: string | null) => x ?? missingWord('unknown', language);
  return [
    { key: 'system', cells: [r['scope.system'], v.scope.system] }, { key: 'company', cells: [r['scope.company'], miss(v.scope.company)] },
    { key: 'branch', cells: [r['scope.branch'], miss(v.scope.branch)] }, { key: 'gstin', cells: [r['scope.gstin'], miss(v.scope.gstin)] },
    { key: 'period', cells: [r['scope.period'], v.scope.period ? `${day(v.scope.period.from, language)} – ${day(v.scope.period.to, language)}` : missingWord('not-loaded-yet', language)] },
  ];
}

type ProposalRow = NonNullable<ReturnType<typeof recipesReply>>['proposals'][number];
function RecipeSheet({ props, recipeId, proposals }: { props: BooksProps; recipeId: string; proposals: readonly ProposalRow[] }) {
  const r = useR2(props.language), a = useAuditWords(props.language);
  const { loaded } = useReply(props, 'books.recipe', { recipeId }, recipeReply, recipeId);
  const v = valueOf(loaded);
  return (
    <BooksSheet props={props} sub="recipes" kind={r['sheet.recipe']} title={v?.recipe.title ?? recipeId}>
      {loaded.phase === 'refused' && <Say code={loaded.code} language={props.language} />}
      {v && (
        <div className={s.stack}>
          <Note>{r[`rstate.${v.recipe.state}`]} · {v.recipe.id} · {v.recipe.version}</Note>
          <Section title={r.scope}><Table view="guided" caption={r.scope} columns={[{ head: r.scope, simple: true }, { head: r['col.meaning'], simple: true }]} rows={scopeRows(v, r, props.language)} /></Section>
          <Section title={r.bindings}>
            <Table view={props.view} caption={r.bindings} columns={[
              { head: r['col.meaning'], simple: true }, { head: r['col.headings'], simple: true }, { head: r['col.type'] }, { head: r['col.accepted'], simple: true }, { head: r['col.grade'] },
            ]} rows={v.bindings.map(b => ({ key: b.meaning, cells: [
              `${b.meaning}${b.required ? '' : ` (${r.optional})`}`, b.headings.join(', '), b.type,
              b.acceptedBy ? fill(r.acceptedBy, { by: b.acceptedBy.by, role: b.acceptedBy.role }) : <span className={s.missing}>{b.state === 'seed' ? r.seedNobody : r.proposedWord}</span>,
              b.grade ? r[`grade.${b.grade}`] : <span className={s.missing}>{missingWord('absent', props.language)}</span>,
            ] }))} />
          </Section>
          <Section title={r.checkTitle}>
            {v.check === null ? <Note>{r.noCheck}</Note> : (
              <>
                <Note>{dayTime(v.check.at, props.language)}</Note>
                <TwoTotals {...v.check} w={r} language={props.language} />
                {v.check.match === 'no' && <p className={s.amber}>{r.totalsDiffer}</p>}
              </>
            )}
          </Section>
          <Section title={r.questions}>
            {v.questions.length === 0 ? <Note>{r['empty.questions']}</Note> : (
              <>
                <ul className={s.list}>{v.questions.map(q => (
                  <li key={q.envelopeId}>
                    <strong>{r[`reason.${q.reason}`]}</strong>{q.field ? ` · ${q.field}` : ''}{q.question ? ` · ${q.question}` : ''}
                    {q.choices.length > 0 && <ul className={s.list} aria-label={r.choices}>{q.choices.map(c => <li key={c}>{c}</li>)}</ul>}
                    {q.reason === 'check-failed' && <TwoTotals ours={q.ours} theirs={q.theirs} measure={q.measure} unit={q.unit} match="no" w={r} language={props.language} />}
                  </li>
                ))}</ul>
                <Note>{r.answerByReading}</Note>
              </>
            )}
          </Section>
          {v.newer && <p className={s.amber}>{fill(r.newer, { old: v.newer.readWith, now: v.newer.current })}</p>}
          {v.notices.length > 0 && <Section title={r.notices}><ul className={s.list}>{v.notices.map(n => <li key={n}>{n}</li>)}</ul></Section>}
          {/* BK-05 to BK-09: a change to this recipe's sources, proposed from a field, can be tried on a copy from here. */}
          <Section title={a.recipeProposals}>
            {(() => {
              const mine = proposals.filter(p => v.sourceIds.includes(p.sourceId) && p.valid && (p.state === 'proposed' || p.state === 'accepted'));
              return mine.length === 0 ? <Note>{a.noRecipeProposals}</Note> : (
                <ul className={s.list}>{mine.map(p => (
                  <li key={p.id} className={s.inline}>
                    <Link onPress={() => props.navigate({ place: 'books', sub: 'recipes', sheet: sheetOf(`p:${p.id}`) })}>{p.field}</Link> · {r[`pstate.${p.state}`]}
                    {prepares(props) && <Button onClick={() => props.navigate({ place: 'books', sub: 'trial', sheet: sheetOf(`p:${p.id}`) })}>{r.tryCopy}</Button>}
                  </li>
                ))}</ul>
              );
            })()}
          </Section>
        </div>
      )}
    </BooksSheet>
  );
}

function ProposalSheet({ props, id, onChanged }: { props: BooksProps; id: string; onChanged: () => void }) {
  const r = useR2(props.language);
  const { loaded, reload } = useReply(props, 'books.proposal', { id }, proposalView, id);
  const act = useAct(props.rpc);
  const p = valueOf(loaded);
  const decide = async (decision: 'accept' | 'decline', v: ProposalView) => {
    if ((await act.run('books.decideProposal', { id: v.id, decision, digest: v.digest ?? '' }, proposalView)).ok) { reload(); onChanged(); }
  };
  return (
    <BooksSheet props={props} sub="recipes" kind={r['sheet.proposal']} title={p ? `${r.mapThis}: ${p.field}` : r['sheet.proposal']}
      actions={p && p.state === 'proposed' && prepares(props) ? (
        <>
          {p.valid && p.removed.length === 0 && <Button variant="filled" onClick={() => { void decide('accept', p); }} disabled={act.busy}>{r.accept}</Button>}
          <Button onClick={() => { void decide('decline', p); }} disabled={act.busy}>{r.decline}</Button>
        </>
      ) : undefined}>
      {loaded.phase === 'refused' && <Refusal code={loaded.code} language={props.language} />}
      {p && (
        <div className={s.stack}>
          <Note>{r[`pstate.${p.state}`]} · {p.proposedBy} · {dayTime(p.at, props.language)} · {p.sourceId}</Note>
          <p>{fill(p.fieldBound ? r.fieldBound : r.fieldNotBound, { field: p.field })}</p>
          {p.decided && <p>{p.state === 'declined' ? fill(r.declinedNote, { by: p.decided.by }) : fill(r.acceptedNote, { by: p.decided.by, role: p.decided.role })}</p>}
          {!p.valid && <p className={s.amber}>{r.invalidProposal}</p>}
          {p.baseChanged && <p className={s.amber}>{r.baseChanged}</p>}
          <Section title={r.bindings}>
            <Table view={props.view} caption={r.bindings} columns={[
              { head: r['col.target'], simple: true }, { head: r['col.from'], simple: true }, { head: r['col.change'] }, { head: r['col.accepted'], simple: true }, { head: r['col.grade'] },
            ]} rows={p.bindings.map(b => ({ key: b.target, cells: [
              b.target, b.source ?? missingWord('absent', props.language),
              <span className={b.change === 'same' ? s.note : undefined}>{r[`change.${b.change}`]}</span>,
              b.acceptedBy ? fill(r.acceptedBy, { by: b.acceptedBy.by, role: b.acceptedBy.role }) : <span className={s.missing}>{b.state === 'proposed' ? r.proposedWord : missingWord('unknown', props.language)}</span>,
              b.grade ? r[`grade.${b.grade}`] : <span className={s.missing}>{missingWord('absent', props.language)}</span>,
            ] }))} />
          </Section>
          {p.dropped.length > 0 && <p className={s.amber}>{fill(r.dropped, { list: p.dropped.join(', ') })}</p>}
          {p.removed.length > 0 && <Section title={r.removedTitle}><ul className={s.list}>{p.removed.map((x, i) => <li key={`${x.path}-${i}`}>{x.path} · <span className="fig">{x.code}</span></li>)}</ul></Section>}
          {p.missingTargets.length > 0 && <Section title={r.missingTitle}><ul className={s.list}>{p.missingTargets.map(t => <li key={t}>{t}</li>)}</ul></Section>}
          {p.valid && (p.state === 'proposed' || p.state === 'accepted') && prepares(props) && (
            <Actions><Button onClick={() => props.navigate({ place: 'books', sub: 'trial', sheet: sheetOf(`p:${p.id}`) })}>{r.tryCopy}</Button></Actions>
          )}
          <Say code={act.refusal} language={props.language} />
        </div>
      )}
    </BooksSheet>
  );
}
