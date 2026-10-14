/** BK-03 Add a source: the systems with what Chausar can do per operation, then the way in. */
import { useState, type FormEvent } from 'react';
import { Label } from '../../parts/Label';
import { Field } from '../../parts/Field';
import { Choice } from '../../parts/Choice';
import { Section, Note, Actions, Button } from '../work/kit/Page';
import { useAct, useReply } from '../work/kit/reply.ts';
import { connectionView, systemsReply, type SystemRow } from './contract.ts';
import { BooksPage, BooksSheet, Link, Table, approves, fill, idOf, sheetOf, styles as s, valueOf, type BooksProps } from './shared.tsx';
import { Say } from './r2-parts.tsx';
import { useR2, type R2, type R2Key } from './words-r2.ts';

const depthWord = (row: SystemRow, r: R2) => row.depth === null ? r['depth.none'] : r[`depth.${row.depth}`];
const evidence = (e: SystemRow['evidence'], r: R2) => fill(r.evidenceLine, { s: e.synthetic, m: e.madeToOrder, r: e.realWithConsent });

export function AddSource(props: BooksProps) {
  const r = useR2(props.language);
  const { loaded, reload } = useReply(props, 'books.systems', {}, systemsReply);
  const value = valueOf(loaded);
  const open = idOf(props.address.sheet);
  const chosen = value?.systems.find(x => x.id === open) ?? null;
  return (
    <BooksPage props={props} sub="add" title={r['title.add']} count={value ? String(value.systems.length) : undefined} loaded={loaded} reload={reload}>
      {value && !value.available && <Note>{r['say.CONNECTORS_NOT_INSTALLED']}</Note>}
      {value && value.available && (value.systems.length === 0 ? <Note>{r['empty.systems']}</Note> : (
        <Table view={props.view} caption={r['title.add']} columns={[
          { head: r['col.system'], simple: true }, { head: r['col.cando'], simple: true }, { head: r['col.tested'] }, { head: r['col.evidence'] }, { head: r['col.tier'] },
        ]} rows={value.systems.map(row => ({ key: row.id, cells: [
          <Link onPress={() => props.navigate({ place: 'books', sub: 'add', sheet: sheetOf(row.id) })}>{row.name}</Link>,
          row.available ? depthWord(row, r) : <span className={s.missing}>{r.plannedSystem}</span>,
          <span>{r[`opstatus.${row.status}`]}{!row.liveVerified && row.available ? <><br /><span className={s.note}>{r.notLive}</span></> : null}</span>,
          evidence(row.evidence, r),
          row.tier === 'experimental' ? <Label kind="experimental" /> : r[`tier.${row.tier}`],
        ] }))} />
      ))}
      {chosen && <SystemSheet props={props} row={chosen} />}
    </BooksPage>
  );
}

function SystemSheet({ props, row }: { props: BooksProps; row: SystemRow }) {
  const r = useR2(props.language);
  return (
    <BooksSheet props={props} sub="add" kind={r['sheet.system']} title={row.name}>
      <div className={s.stack}>
        <Note>{depthWord(row, r)} · {r[`opstatus.${row.status}`]} · {evidence(row.evidence, r)}</Note>
        {/* A claim is per operation and per system, never per logo. */}
        <Table view={props.view === 'simple' ? 'guided' : props.view} caption={row.name} columns={[
          { head: r['col.operation'], simple: true }, { head: r['col.depth'], simple: true }, { head: r['col.tested'], simple: true }, { head: r['col.limit'] },
        ]} rows={row.operations.map(op => ({ key: op.id, cells: [op.label, r[`depth.${op.depth}`], <span className={op.status === 'not-possible' || op.status === 'planned' ? s.missing : undefined}>{r[`opstatus.${op.status}`]}</span>, op.limitation] }))} />
        {!row.available ? <p className={s.amber}>{r.plannedSystem}</p> : approves(props) ? <WayIn props={props} row={row} /> : <Note>{r.ownerConnects}</Note>}
      </div>
    </BooksSheet>
  );
}

type Way = 'interface' | 'file' | 'database';
type TallyWhere = 'here' | 'network' | 'other';
function WayIn({ props, row }: { props: BooksProps; row: SystemRow }) {
  const r = useR2(props.language);
  const act = useAct(props.rpc);
  const tally = row.id === 'tally';
  const [way, setWay] = useState<Way>(row.ways[0] ?? 'file');
  const [where, setWhere] = useState<TallyWhere>('here');
  const [company, setCompany] = useState('');
  const [label, setLabel] = useState('');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [made, setMade] = useState<string | null>(null);
  const keys = way === 'interface' ? row.settings.filter(k => !(tally && k === 'company')) : [];
  // Tally beyond this computer cannot be read yet: those two ways in point to a file instead.
  const blocked = tally && way === 'interface' && where !== 'here';
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!company.trim() || blocked) return;
    const typed = Object.fromEntries(Object.entries(settings).filter(([k, v]) => keys.includes(k) && v.trim()).map(([k, v]) => [k, v.trim()]));
    if (tally && way === 'interface') typed.company = company.trim();
    const outcome = await act.run('books.connect', { group: row.id, road: way, company: company.trim(), ...(label.trim() ? { label: label.trim() } : {}), ...(Object.keys(typed).length ? { settings: typed } : {}) }, connectionView);
    if (outcome.ok) setMade(outcome.value.sourceId);
  };
  return (
    <Section title={r.wayInTitle}>
      <form className={s.form} aria-label={r.wayInTitle} onSubmit={event => { void submit(event); }}>
        {row.ways.length > 1 && <Choice<Way> label={r.wayInTitle} options={row.ways.map(x => ({ value: x, label: r[`way.${x}`] }))} value={way} onChange={setWay} />}
        {tally && way === 'interface' && (
          <>
            <Choice<TallyWhere> label={r.tallyWhere} options={(['here', 'network', 'other'] as const).map(x => ({ value: x, label: r[`tally.${x}`] }))} value={where} onChange={setWhere} />
            {where === 'network' && <p className={s.amber}><Label kind="experimental" /> {r.tallyNetwork}</p>}
            {where === 'other' && <p className={s.amber}><Label kind="experimental" /> {r.tallyOther}</p>}
          </>
        )}
        <Field label={tally ? r.whichCompany : r.company} value={company} onChange={e => setCompany(e.target.value)} />
        {tally && <Note>{r.companyTally}</Note>}
        {keys.map(key => (
          <Field key={key} label={(Object.hasOwn(r, `set.${key}`) ? r[`set.${key}` as R2Key] : key)} value={settings[key] ?? ''} onChange={e => setSettings({ ...settings, [key]: e.target.value })} />
        ))}
        <Field label={r.label} value={label} onChange={e => setLabel(e.target.value)} />
        <Note>{r.noSecrets}</Note>
        {way === 'interface' && <Note>{r[`signin.${row.signIn.method}`]}{row.signIn.note ? ` ${row.signIn.note}` : ''}</Note>}
        <Actions><Button submit variant="filled" disabled={!company.trim() || blocked || act.busy}>{r.connect}</Button></Actions>
        <Say code={act.refusal} language={props.language} />
        {made && (
          <p role="status">{r.connected} <Link onPress={() => props.navigate({ place: 'books', sub: 'sources', sheet: sheetOf(made) })}>{r.openSource}</Link></p>
        )}
      </form>
    </Section>
  );
}
