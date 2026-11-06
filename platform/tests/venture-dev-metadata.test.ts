// Registration and browser onboarding stay pinned to this exact developer contract.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {DEV_DATA} from '../runtime/venture/playbooks/dev-agency/definition-data.ts';
import {DEV_AGENCY_DEFINITION} from '../runtime/venture/playbooks/dev-agency/definition.ts';
import {DEV_AGENCY_REGISTRATION} from '../runtime/venture/playbooks/dev-agency/registration.ts';
test('developer kit is registered and browser metadata preserves its three owner-priced services',()=>{assert.equal(DEV_AGENCY_REGISTRATION?.id,'dev-agency');assert.equal(DEV_AGENCY_DEFINITION?.registration.id,'dev-agency');const source=readFileSync(new URL('../../app/ui/src/engine/dev-metadata.ts',import.meta.url),'utf8'),meta=JSON.parse(source.slice(source.indexOf('=')+1,source.lastIndexOf('as const')).trim());assert.deepEqual(meta,{registration:DEV_DATA.registration,offers:DEV_DATA.offers.map(({id,name,description,pricing,unit,intake,rights})=>({id,name,description,pricing,unit,intake,rights})),intakeFields:DEV_DATA.intakeFields});});

import { VENTURE_ERRORS } from '../runtime/venture/contract-values.ts';
test('developer public refusal codes survive host transport',()=>{for(const code of ['DEV_PROJECT_NOT_FOUND','DEV_SOURCE_INVALID','DEV_AUDIT_REQUIRED','DEV_CLI_PENDING','FIRST_WEEK_REPORT_ONLY'])assert.ok((VENTURE_ERRORS as readonly string[]).includes(code),code);});


test('developer browser rule view keeps professional waiting, source links and dated freshness',async()=>{const {devRules}=await import(new URL('../../app/ui/src/engine/dev-rules.ts',import.meta.url).href),{rulesListOf}=await import('../runtime/venture/playbooks/rules-view.ts');for(const today of ['2026-10-29','2027-01-27','2027-01-28','2027-07-20'])assert.deepEqual(devRules(today),rulesListOf(DEV_DATA.registration,today));});
