/** BK-11 Accounts: the chart of accounts sorted into classes, with you as the judge. */
import { useState } from 'react';
import { Note, Refusal, Button } from '../work/kit/Page';
import { useAct, useReply } from '../work/kit/reply.ts';
import { day } from '../work/kit/format.ts';
import { accountRow, accountsProposed, accountsReply, classesReply, ACCOUNT_CLASSES, type AccountClass, type AccountRow } from './contract.ts';
import { BooksPage, Table, fill, prepares, styles as s, useWords, valueOf, type BooksProps, type W } from './shared.tsx';
import { useAuditWords, type AuditWords } from './words-audit.ts';

type Because = NonNullable<AccountRow['because']>[number];
/** One reason in the person's language. A class the recipe names is shown as it came. */
function becauseText(b: Because, a: AuditWords, w: W): string {
  switch (b.code) {
    case 'group': return b.under ? fill(a['because.groupUnder'], { group: b.group ?? '', under: b.under }) : fill(a['because.group'], { group: b.group ?? '' });
    case 'group-unsortable': return fill(a['because.group-unsortable'], { group: b.group ?? '' });
    case 'side': return b.side === 'credit' ? a['because.side.credit'] : a['because.side.debit'];
    case 'recipe': { const known = ACCOUNT_CLASSES.find(c => c === b.cls); return fill(a['because.recipe'], { cls: known ? w[`class.${known}`] : b.cls ?? '' }); }
    default: return a[`because.${b.code}`];
  }
}

const className = (c: AccountClass, w: W) => w[`class.${c}`];

export function Accounts(props: BooksProps) {
  const w = useWords(props.language), a = useAuditWords(props.language);
  const { loaded, reload } = useReply(props, 'accounts.list', {}, accountsReply);
  const classes = useReply(props, 'accounts.classes', {}, classesReply);
  const value = valueOf(loaded);
  const known = valueOf(classes.loaded)?.classes ?? ACCOUNT_CLASSES;
  const act = useAct(props.rpc);
  const [changing, setChanging] = useState<string | null>(null);
  const decide = async (row: AccountRow, decision: 'yes' | 'no' | 'change', cls?: AccountClass) => {
    const outcome = await act.run('accounts.decide', { name: row.name, decision, ...(cls ? { class: cls } : {}) }, accountRow);
    if (outcome.ok) { setChanging(null); reload(); }
  };
  // The reason as codes in the person's language; an older engine sends English sentences only.
  const reason = (row: AccountRow) => row.because
    ? row.because.map(b => becauseText(b, a, w)).join(' · ')
    : [row.group !== null ? fill(w.inGroup, { group: row.group }) : null, row.side !== null ? w[`side.${row.side}`] : null, ...row.reason]
      .filter((part): part is string => part !== null).join(' · ');
  const decision = (row: AccountRow) => {
    if (row.state === 'decided' && row.decided) {
      return fill(row.decided.role === 'accountant' ? w.correctedBy : w.decidedBy, { cls: className(row.decided.class, w), by: row.decided.by, role: row.decided.role, when: day(row.decided.at, props.language) });
    }
    if (props.viewer) return row.state === 'unsure' ? w.unsureAsks : w.awaitingDecision;
    if (changing === row.name) {
      return (
        <label className={s.selectLabel}>{w.pickClass}
          <select className={s.select} defaultValue="" onChange={e => { const c = ACCOUNT_CLASSES.find(k => k === e.target.value); if (c) void decide(row, 'change', c); }}>
            <option value="" disabled>{w.pickClass}</option>
            {known.map(c => <option key={c} value={c}>{className(c, w)}</option>)}
          </select>
        </label>
      );
    }
    return (
      <span className={s.inline}>
        {row.state === 'unsure' && <span className={s.amber}>{w.unsureAsks}</span>}
        {row.proposed !== null && <Button onClick={() => { void decide(row, 'yes'); }} disabled={act.busy}>{w.yes}</Button>}
        {row.proposed !== null && <Button onClick={() => { void decide(row, 'no'); }} disabled={act.busy}>{w.no}</Button>}
        <Button variant="link" onClick={() => setChanging(row.name)} disabled={act.busy}>{w.change}</Button>
      </span>
    );
  };
  return (
    <BooksPage props={props} sub="accounts" title={w['title.accounts']} count={value ? String(value.accounts.length) : undefined} loaded={loaded} reload={reload}>
      {value && !value.proposals.available && <Note>{fill(w.notBuiltNamed, { what: w.proposals })}</Note>}
      {value && value.proposals.available && (
        <p className={s.inline}>
          {value.proposals.sortedAt !== undefined && <span>{fill(a.sortedAt, { date: day(value.proposals.sortedAt, props.language) })}</span>}
          {prepares(props) && value.accounts.length > 0 && <Button onClick={() => { void act.run('accounts.propose', {}, accountsProposed).then(o => { if (o.ok) reload(); }); }} disabled={act.busy}>{a.sortAsk}</Button>}
        </p>
      )}
      {value && <Note>{a.namesStay}</Note>}
      {value && (value.accounts.length === 0 ? <Note>{w['empty.accounts']}</Note> : (
        <Table view={props.view} caption={w['title.accounts']} columns={[
          { head: w['col.account'], simple: true }, { head: w['col.proposed'], simple: true }, { head: w['col.reason'] }, { head: w['col.decision'], simple: true },
        ]} rows={value.accounts.map(row => ({ key: row.name, cells: [
          row.name,
          row.proposed === null ? <span className={s.missing}>{w.noProposal}</span> : className(row.proposed, w),
          reason(row) || <span className={s.missing}>{w.noReason}</span>,
          decision(row),
        ] }))} />
      ))}
      <Refusal code={act.refusal} language={props.language} />
    </BooksPage>
  );
}
