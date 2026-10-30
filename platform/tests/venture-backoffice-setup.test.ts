// Finance workspace isolation after finance-workspace (MIT ideas); original Chausar tests.
import assert from 'node:assert/strict';
import test from 'node:test';
import { financeCycle, rowsForCycle } from '../runtime/venture/playbooks/bookkeeping-cfo/cycles.ts';
import { setupDraft } from '../runtime/venture/playbooks/bookkeeping-cfo/setup.ts';

const input={businessId:'business-a',clientId:'client-a',system:'zoho' as const,companyId:'company-a',from:'2026-04-01',to:'2027-03-31'};
test('finance cycles isolate clients, systems and years with safe distinct folders',()=>{
 const current=financeCycle(input),last=financeCycle({...input,from:'2025-04-01',to:'2026-03-31'});
 assert.notEqual(current.id,last.id);assert.notEqual(current.folder,last.folder);
 assert.notEqual(current.id,financeCycle({...input,clientId:'client-b'}).id);
 assert.notEqual(current.id,financeCycle({...input,companyId:'company-b'}).id);
 assert.deepEqual(rowsForCycle([{cycleId:last.id,note:'last year'},{cycleId:current.id,note:'this year'}],current),[{cycleId:current.id,note:'this year'}]);
 assert.match(current.folder,/^finance\/cycle_[a-f0-9]{32}$/);
 assert.throws(()=>financeCycle({...input,from:'2026-02-30'}),{code:'BOOKS_CYCLE_INVALID'});
 assert.throws(()=>financeCycle({...input,to:'2025-01-01'}),{code:'BOOKS_CYCLE_INVALID'});
 assert.throws(()=>financeCycle({...input,unexpected:true} as any),{code:'BOOKS_SETUP_INVALID'});
});
test('setup preserves source-backed customers vendors categories and exact balanced opening entries',()=>{
 const cycle=financeCycle(input);
 const source={cycle,customers:[{id:'customer-a',name:'Tea shop',source:'client.csv:2'}],vendors:[{id:'vendor-a',name:'Tea supplier',source:'vendor.csv:2'}],categories:[{id:'bank',name:'Bank',source:'chart.csv:2'},{id:'capital',name:'Capital',source:'chart.csv:3'}],opening:[{accountId:'bank',debitMinor:'900719925474099',creditMinor:'0',source:'opening.csv:2'},{accountId:'capital',debitMinor:'0',creditMinor:'900719925474099',source:'opening.csv:3'}]};
 const draft=setupDraft(source);assert.equal(draft.debitMinor,'900719925474099');assert.equal(draft.creditMinor,draft.debitMinor);assert.equal(draft.state,'draft');assert.equal(draft.systemOfRecord,'client');assert.match(draft.receiptId,/^books_setup_/);
 assert.throws(()=>setupDraft({...source,opening:[source.opening[0]!]}),{code:'BOOKS_OPENING_UNBALANCED'});
 assert.throws(()=>setupDraft({...source,opening:[{...source.opening[0]!,accountId:'unknown'},source.opening[1]!]}),{code:'BOOKS_ACCOUNT_REQUIRED'});
 assert.throws(()=>setupDraft({...source,customers:[source.customers[0]!,source.customers[0]!]}),{code:'BOOKS_SETUP_INVALID'});
 assert.throws(()=>setupDraft({...source,opening:[{...source.opening[0]!,debitMinor:'1.5'},source.opening[1]!]}),{code:'BOOKS_SETUP_INVALID'});
});
