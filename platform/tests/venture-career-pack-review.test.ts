import test from 'node:test';import assert from 'node:assert/strict';
import {careerPack} from '../runtime/venture/playbooks/job-search-desk/pack.ts';
test('career pack kind must be an exact enum string, never an array coerced as an object key',()=>{const fact={id:'f1',statement:'Interviewed customers',qualifiers:['as an intern'],forbiddenUses:[]};for(const kind of [['resume'],{toString:()=> 'resume'}])assert.throws(()=>careerPack([fact],[],{kind,claims:[{factId:'f1',use:'research'}],sources:[]} as any),{code:'INVALID_VENTURE_REQUEST'});});
