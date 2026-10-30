import test from 'node:test';
import assert from 'node:assert/strict';
import {responseHours} from '../runtime/venture/playbooks/support-desk/due.ts';
test('fractional business-hour targets remain valid without loose input coercion',()=>{assert.equal(responseHours('0.5'),0.5);assert.equal(responseHours(24),24);for(const value of ['',true,null,'5hrs','-1','Infinity'])assert.throws(()=>responseHours(value),{code:'SUPPORT_HOURS_INVALID'});});
