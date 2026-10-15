import type { EngineModule, MethodSpec } from './types.ts';
import { peekModuleState } from './types.ts';
import type { AskState } from '../ask/contracts.ts';
import { input } from '../ask/shared.ts';
import { menu, suggest, understand, wanted } from '../ask/menu.ts';
import { answer, exportReceipt, guard, receiptView, run, sent, sourceRows } from '../ask/answers.ts';
import { rebuild, save, saved, saveRef, unsave } from '../ask/saved.ts';
import { getCheck, listChecks, removeCheck, runChecks, saveCheck, tickChecks } from '../ask/checks.ts';
import { get as whyGet, guess as whyGuess, start as whyStart } from '../ask/why.ts';
import { plan, whatIf, whatIfGet } from '../ask/whatif.ts';
import { forecast } from '../ask/forecast.ts';
import { confirm, discard, draft, getDecision, inbox, listDecisions, review } from '../ask/decisions.ts';
import { search } from '../ask/search.ts';
import { exportIms, gst2b, line, setTolerance } from '../ask/gst2b.ts';
import { change, explainRule, stop, tell } from '../ask/round4.ts';

const read = (handler: MethodSpec['handler']): MethodSpec => ({ permission: 'read', handler });
const prepare = (handler: MethodSpec['handler']): MethodSpec => ({ permission: 'prepare', handler });

/** Lane-owned engine methods (the `askx.*` family). Only the owning lane edits this file. */
export const askModule: EngineModule = {
  id: 'ask',
  methods: {
    'askx.menu': read(menu),
    'askx.suggest': read(suggest),
    'askx.understand': read(understand),
    'askx.run': read(run),
    'askx.change': read(change),
    'askx.stop': read(stop),
    'askx.tell': prepare(tell),
    'askx.explainRule': read(explainRule),
    'askx.answer': read(answer),
    'askx.guard': read(guard),
    'askx.receipt': read(receiptView),
    'askx.sourceRows': read(sourceRows),
    'askx.sent': read(sent),
    'askx.wanted': read(wanted),
    'askx.save': prepare(save),
    'askx.saveRef': prepare(saveRef),
    'askx.saved': read(saved),
    'askx.rebuild': prepare(rebuild),
    'askx.unsave': prepare(unsave),
    'askx.checks.save': prepare(saveCheck),
    'askx.checks.list': read(listChecks),
    'askx.checks.run': prepare((ctx, payload, host) => { input(payload, []); return runChecks(ctx, host); }),
    'askx.checks.get': read(getCheck),
    'askx.checks.remove': prepare(removeCheck),
    'askx.why.start': read(whyStart),
    'askx.why.get': read(whyGet),
    'askx.why.guess': prepare(whyGuess),
    'askx.whatIf': read(whatIf),
    'askx.whatIf.get': read(whatIfGet),
    'askx.receipt.export': read(exportReceipt),
    'askx.plan': read(plan),
    'askx.forecast': read(forecast),
    'askx.decisions.inbox': read(inbox),
    'askx.decisions.draft': prepare((ctx, payload, host) => draft(ctx, payload, host, 'typed')),
    'askx.decisions.confirm': prepare(confirm),
    'askx.decisions.discard': prepare(discard),
    // Experimental: text forwarded from the phone becomes a draft only; confirming needs the app.
    'askx.decisions.forward': { permission: 'prepare', phone: true, handler: (ctx, payload, host) => draft(ctx, payload, host, 'forwarded') },
    'askx.decisions.list': read(listDecisions),
    'askx.decisions.get': read(getDecision),
    'askx.decisions.review': prepare(review),
    'askx.search': read(search),
    'askx.gst2b': read(gst2b),
    // The tolerance changes every seat's IMS list: an owner or cofounder decides it.
    'askx.gst2b.tolerance': { permission: 'approve', handler: setTolerance },
    'askx.gst2b.line': read(line),
    'askx.gst2b.exportIms': read(exportIms),
  },
  purge(state, reason) {
    const own = peekModuleState<AskState>(state, 'ask');
    if (!own) return 0;
    const touched = (ids: readonly string[]) => ids.some(id => reason.sourceIds.includes(id));
    let removed = 0;
    // A saved item keeps only its question and the day its source was deleted.
    for (const item of own.saved) if (!item.deletedOn && (touched(item.sourceIds) || item.receiptId !== null && reason.removedIds.has(item.receiptId))) {
      Object.assign(item, { receiptId: null, request: null, refId: null, headline: null, workedOutAt: null, sourceIds: [], deletedOn: reason.at.slice(0, 10) }); removed++;
    }
    const checks = own.checks.length, why = own.why.length;
    own.checks = own.checks.filter(c => !touched(c.sourceIds) && !c.results.some(r => r.receiptId !== null && reason.removedIds.has(r.receiptId)));
    own.why = own.why.filter(w => !touched(w.sourceIds));
    // Retained forecast receipts are only a cache: any deletion drops them all.
    const runs = own.forecastRuns?.length ?? 0; own.forecastRuns = [];
    return runs + removed + (checks - own.checks.length) + (why - own.why.length);
  },
  async tick(ctx, host) { return tickChecks(ctx, host); },
};
