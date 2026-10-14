/**
 * TR-01 Rules: See, Send, Keep and Do in a few words each, opened in place or as a full
 * page in a sheet; what left this computer today as a small drawing; the personal-data note.
 */
import { useState } from 'react';
import type { RowItem } from '../../app/presentation.ts';
import { withSheet } from '../../app/routes.ts';
import { words } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { RowList } from '../../parts/RowList';
import { useEngine } from './kit/engine.ts';
import { Group, Note, Screen } from './kit/Screen';
import { countText, powers, type P } from './common';
import { DoView } from './Do';
import { KeepView } from './Keep';
import { SeeView } from './See';
import { SendView } from './Send';
import { validateRules, type LeftItem, type Rules } from './validate.ts';
import { COMMON, RULES, fill } from './words.ts';
import s from './Trust.module.css';
import r from './Rules.module.css';

const RULE_SHEETS = ['see', 'send', 'keep', 'do'] as const;
type RuleId = (typeof RULE_SHEETS)[number];

export function RulesScreen(p: P) {
  const c = words(COMMON, p.language);
  const { state, reload } = useEngine(p.rpc, 'trustx.rules', {}, validateRules);
  const sheet = p.address.sheet;
  return (
    <>
      <Screen where={c.whereRules} title={c.rules} loaded={state}>{(rules) => <RulesBody p={p} rules={rules} />}</Screen>
      {sheet === 'see' && <SeeView p={p} mode="sheet" onChanged={reload} />}
      {sheet === 'send' && <SendView p={p} mode="sheet" onChanged={reload} />}
      {sheet === 'keep' && <KeepView p={p} mode="sheet" onChanged={reload} />}
      {sheet === 'do' && <DoView p={p} mode="sheet" onChanged={reload} />}
    </>
  );
}

function setting(rules: Rules, id: RuleId, w: ReturnType<typeof words<keyof typeof RULES.en>>): string {
  switch (id) {
    case 'see': return rules.see.allSources ? w.seeAll : fill(w.seeSome, { allowed: countText(rules.see.allowed), refused: countText(rules.see.refused) });
    case 'send': {
      const level = rules.send.level === 'nothing' ? w.sendNothing : rules.send.level === 'shape' ? w.sendShape : w.sendSamples;
      return rules.send.localOnly ? `${level} ${w.localOnly}` : level;
    }
    case 'keep': return rules.keep.days === null ? w.keepForever : fill(w.keepDays, { days: countText(rules.keep.days) });
    case 'do': return w[`preset.${rules.do.preset}`];
  }
}

function RulesBody({ p, rules }: { p: P; rules: Rules }) {
  const c = words(COMMON, p.language), w = words(RULES, p.language);
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const admin = powers(p).admin && rules.canChange;
  const detail: Record<RuleId, string> = { see: w.detailSee, send: w.detailSend, keep: w.detailKeep, do: w.detailDo };
  const rows: RowItem[] = RULE_SHEETS.map((id) => ({ id, mark: 'you', what: c[id], note: setting(rules, id, w) }));
  return (
    <>
      <RowList
        rows={rows}
        openId={openId}
        onOpen={(id) => setOpenId((now) => (now === id ? undefined : id))}
        onReceipt={p.openReceipt}
        expansion={(row) => {
          const id = row.id as RuleId;
          const ownerOnly = !admin && (rules.ownerOnly as readonly string[]).includes(id);
          return (
            <div className={s.stack}>
              <p className={s.quiet}>{detail[id]}</p>
              {ownerOnly ? <p className={s.quiet}>{c.ownerOnly}</p> : !admin && <p className={s.quiet}>{c.adminOnly}</p>}
              <span><Button variant="link" onClick={() => p.navigate(withSheet(p.address, id))}>{w.openPage}</Button></span>
            </div>
          );
        }}
      />
      <Group title={w.leftTitle}>
        <LeftToday p={p} items={rules.leftToday.items} />
      </Group>
      <Note>
        {w.foot}{' '}
        <Button variant="link" onClick={() => p.navigate({ place: 'books', sub: 'customers' })}>{w.linkCustomers}</Button>{' · '}
        <Button variant="link" onClick={() => p.navigate({ place: 'trust', sub: 'vault', sheet: 'delete' })}>{w.linkReport}</Button>
      </Note>
    </>
  );
}

const ROW_H = 28, TOP = 12, WIDTH = 360;

/** This computer at the left, one line out to each destination, labelled with its count. */
function LeftToday({ p, items }: { p: P; items: readonly LeftItem[] }) {
  const w = words(RULES, p.language);
  if (items.length === 0) return <p className={s.quiet}>{w.leftNone}</p>;
  const height = Math.max(56, items.length * ROW_H + TOP * 2);
  const mid = height / 2;
  const labels = items.map((it) => fill(it.stopped ? w.leftStopped : w.leftLine, { destination: it.destination, count: countText(it.count) }));
  return (
    <figure className={r.figure}>
      <svg className={r.drawing} viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={fill(w.leftSentence, { n: countText(items.length) })}>
        <rect className={r.computer} x={4} y={mid - 14} width={88} height={28} rx={2} />
        <text className={r.computerText} x={48} y={mid + 4} textAnchor="middle">{w.thisComputer}</text>
        {items.map((it, i) => {
          const y = TOP + ROW_H * i + ROW_H / 2;
          const label = labels[i] ?? '';
          return (
            <g key={`${it.destination}-${i}`}>
              <line className={it.stopped ? r.stopped : r.out} x1={92} y1={mid} x2={168} y2={y} />
              <circle className={r.dot} cx={170} cy={y} r={2.5} />
              <text className={r.label} x={178} y={y + 4}>
                <title>{label}</title>
                {label.length > 30 ? `${label.slice(0, 29)}…` : label}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="sr">{labels.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </figure>
  );
}
