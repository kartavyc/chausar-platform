// Browser rehearsal reads generated native rule data. Freshness wording matches kit/rules.ts.
import data from './landed-kit-rules-data.json' with {type:'json'};
import type {RulesListView} from './types';
type RuleMeta={topic:string;how:string;read:string;window:number;needs:'ca'|'lawyer'|null;confirmed:boolean};
const rows=data as unknown as Record<string,{view:RulesListView;metadata:Record<string,RuleMeta>}>;
export function landedKitRules(id:string,today:string):RulesListView|null{
 const saved=rows[id];if(!saved)return null;
 const out=structuredClone(saved.view);
 for(const rule of out.rules){
  const meta=saved.metadata[rule.id]!,age=Math.floor((Date.parse(today+'T00:00:00Z')-Date.parse(rule.checkedOn+'T00:00:00Z'))/86400000);
  rule.stale=age>meta.window;
  const waiting=meta.needs&&!meta.confirmed?' A '+(meta.needs==='ca'?'CA':'lawyer')+' has not confirmed it yet, so it works in practice runs only.':'';
  rule.line=rule.stale?meta.topic+' was checked '+age+' days ago, on '+rule.checkedOn+'. Check it again'+(meta.read==='house'?'':' on its source page')+' before relying on it.'+waiting:(meta.read==='unconfirmed'?'Not confirmed against a source yet. ':'Current. ')+meta.how+waiting;
 }
 const stale=out.rules.filter(r=>r.stale).length,unsure=out.rules.filter(r=>!r.stale&&saved.metadata[r.id]!.read==='unconfirmed').length;
 out.summary=out.rules.length?`${out.rules.length-stale-unsure} current, ${stale} to recheck${unsure?`, ${unsure} not confirmed against a source yet`:''}.`:'This playbook rests on no dated platform rules.';
 return out;
}
