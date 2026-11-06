import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { preprocessCSS, resolveConfig } from 'vite';
import { RunSheetView } from '../../src/parts/RunSheet';
import { ClockProvider } from '../../src/shell/clock';
import { Figure } from '../../src/parts/Figure';
import figureStyles from '../../src/parts/Figure.module.css';
import controlStyles from '../../src/parts/RunSheetControls.module.css';
import { RUNS } from '../../src/engine/fixtures';
import { assertFiguresProved } from '../helpers/ink-rules';
import { RunScope } from '../../src/parts/RunSheetControls';
import { TextProvider, CATALOGUES, format } from '../../src/text';
import type { RunDetail, Posture } from '../../src/engine/types';

it('lets the run contract wrap its complete multi-amount rate while keeping figures proved and ordinary amounts intact', async () => {
  const run = structuredClone(RUNS.find((row) => row.runId === '31')!);
  run.scope = { tools: [], actions: [], posture: 'approve-each', cap: '$0.40', capReceiptId: 'fig:scope:31', capRupees: '₹33.40', capRate: '₹83.50 per $1 (your rate, set 15 Oct 2026)', line: 'Set when it started: a spend cap of $0.40, approve each step.' };
  const { container } = render(<><RunSheetView run={run} onClose={() => {}} onSteer={async () => {}} /><Figure value="₹33.40" receiptId="receipt-control" /></>);
  const config = await resolveConfig({ configFile: join(import.meta.dirname, '../../vite.config.ts'), logLevel: 'silent' }, 'serve');
  const style = document.createElement('style');
  try {
    for (const [file, renderedClasses] of [['Figure.module.css', figureStyles], ['RunSheetControls.module.css', controlStyles]] as const) {
      const path = join(import.meta.dirname, '../../src/parts', file);
      const compiled = await preprocessCSS(readFileSync(path, 'utf8'), path, config);
      let css = compiled.code;
      for (const [name, compiledClass] of Object.entries(compiled.modules ?? {})) css = css.replaceAll(`.${compiledClass}`, `.${renderedClasses[name]}`);
      style.textContent += css;
    }
    document.head.append(style);
    const numbers = [...container.querySelectorAll<HTMLElement>('[data-ui-number]')];
    const rate = numbers.find((number) => number.textContent?.includes(run.scope!.capRate!))!;
    expect(rate.textContent).toContain(run.scope!.capRupees);
    expect(getComputedStyle(rate).whiteSpace).toBe('normal');
    expect(getComputedStyle(rate.closest('[data-figure]')!).display).toBe('inline');
    expect(getComputedStyle(numbers.at(-1)!).whiteSpace).toBe('nowrap');
    expect(getComputedStyle(numbers.at(-1)!.closest('[data-figure]')!).display).toBe('inline-flex');
    expect(within(container).getByRole('button', {name:`Receipt for ${run.scope!.capRupees} at ${run.scope!.capRate}`})).toBeTruthy();
    expect(container.querySelector('textarea')).toBeTruthy();
    expect(() => assertFiguresProved(container)).not.toThrow();
  } finally { style.remove(); }
}, 30000);

const postureWords: Record<Posture,string> = {rehearsal:'in rehearsal',shadow:'in practice on real orders','approve-each':'at approve each','auto-spot-check':'at auto with spot checks'};
function scoped(posture:Posture,tools:number,actions:number):RunDetail {
 const run=structuredClone(RUNS.find(row=>row.runId==='31')!);
 run.scope={tools:Array(tools).fill('An engine tool'),actions:Array(actions).fill('An engine action'),posture,cap:'$0.40',capReceiptId:'fig:scope:31',capRupees:'₹33.40',capRate:'₹83.50 per $1 (your rate, set 15 Oct 2026)',line:`Set when it started: ${tools} ${tools===1?'tool':'tools'}, ${actions} ${actions===1?'outside action':'outside actions'} it may propose for your approval, a spend cap of $0.40, ${postureWords[posture]}.`};return run;
}

it('keeps every English scope posture and count exact with proved figures and receipts',()=>{
 for(const posture of Object.keys(postureWords) as Posture[])for(const [tools,actions]of [[0,0],[1,1],[3,2]]){
  const run=scoped(posture,tools!,actions!),view=render(<TextProvider language="en"><RunScope run={run}/></TextProvider>);
  const line=view.container.querySelector('p')!;
  expect(line.textContent).toBe(run.scope!.line.replace('$0.40',`$0.40 (${run.scope!.capRupees} at ${run.scope!.capRate})`));
  for(const exact of ['$0.40','₹33.40','₹83.50','$1','15 Oct 2026'])expect(line.textContent).toContain(exact);
  expect(line.querySelectorAll('[data-receipt="fig:scope:31"]')).toHaveLength(2);
  expect(()=>assertFiguresProved(view.container)).not.toThrow();view.unmount();
 }
});
it('keeps English exact and recognizes the known fake variant only when counts and posture agree',()=>{
 const run=scoped('approve-each',3,1);run.scope!.line=run.scope!.line.replace('at approve each.','approve each step.');
 const view=render(<TextProvider language="en"><RunScope run={run}/></TextProvider>);
 expect(view.container.querySelector('p')!.textContent).toBe(run.scope!.line.replace('$0.40',`$0.40 (${run.scope!.capRupees} at ${run.scope!.capRate})`));
 view.rerender(<TextProvider language="en"><RunScope run={run}/></TextProvider>);expect(view.container.querySelector('p')!.textContent).toContain('Set when it started');
 run.scope!.posture='shadow';view.rerender(<TextProvider language="en"><RunScope run={run}/></TextProvider>);expect(view.container.querySelector('p')!.textContent).toContain(run.scope!.line.slice(0,40));
 run.scope!.posture='approve-each';run.scope!.tools=[];view.rerender(<TextProvider language="en"><RunScope run={run}/></TextProvider>);expect(view.container.querySelector('p')!.textContent).toContain(run.scope!.line.slice(0,40));
});
it('preserves unknown scope and rate wording while retaining exact native date display formats',()=>{
 const run=scoped('rehearsal',1,0),view=render(<TextProvider language="en"><RunScope run={run}/></TextProvider>);
 for(const date of ['15 Oct 2026','Oct 15, 2026','2026-10-15']){run.scope!.capRate=`₹83.50 per $1 (your rate, set ${date})`;view.rerender(<TextProvider language="en"><RunScope run={run}/></TextProvider>);expect(view.container.querySelector('p')!.textContent).toContain(date);expect(view.container.querySelector('p')!.textContent).toContain('your rate');}
 run.scope!.capRate='Owner custom ₹83.50 / $1, checked manually';view.rerender(<TextProvider language="en"><RunScope run={run}/></TextProvider>);expect(view.container.querySelector('p')!.textContent).toContain(run.scope!.capRate);
 run.scope!.line='Custom policy: $0.40, only this exact work.';view.rerender(<TextProvider language="en"><RunScope run={run}/></TextProvider>);expect(view.container.querySelector('p')!.textContent).toBe(`Custom policy: $0.40 (${run.scope!.capRupees} at ${run.scope!.capRate}), only this exact work.`);
});

describe('C4 task 12: the time a run took and the time it waited', () => {
  const at = (minutes: number) => new Date(Date.parse('2026-10-21T10:00:00.000Z') + minutes * 60000).toISOString();
  const now = () => new Date(at(8));
  it('a run waiting on the owner says how long it has waited, and what it worked', () => {
    const run = structuredClone(RUNS.find((row) => row.runId === '29')!);
    run.elapsed = '2 min'; run.waitingSince = at(2);
    const { container } = render(<ClockProvider now={now}><RunSheetView run={run} onClose={() => {}} /></ClockProvider>);
    expect(container.textContent).toContain('Waiting 6 min');
    expect(container.textContent).toContain('Worked 2 min');
    expect(container.textContent).not.toContain('Started 2 min ago');
  });
  it('a finished run says what it took without the waits, then the wait itself', () => {
    const run = structuredClone(RUNS.find((row) => row.runId === '27')!);
    run.elapsed = '2 min'; run.waited = '6 min';
    const { container } = render(<RunSheetView run={run} onClose={() => {}} />);
    expect(container.querySelector('details[data-fold="worked"] summary')!.textContent).toBe('Took 2 min, waited on you 6 min');
  });
  it('a run with no call times keeps its one figure and never a wait', () => {
    const run = structuredClone(RUNS.find((row) => row.runId === '27')!);
    const { container } = render(<RunSheetView run={run} onClose={() => {}} />);
    expect(container.querySelector('details[data-fold="worked"] summary')!.textContent).toBe('Took 4 min');
  });
});
