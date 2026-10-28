import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreTranslationBaseline,TRANSLATION_CASES} from '../runtime/venture/playbooks/translation-studio/checks.ts';
test('translation baselines execute typed sources and reject tampered expected labels',()=>{for(const c of TRANSLATION_CASES){assert.equal(scoreTranslationBaseline(c,c.draft,c.meta??{}).pass,true,c.id);const source=JSON.parse(c.meta!.source);source[0].source+=' MISSING991';assert.equal(scoreTranslationBaseline(c,c.draft,{...c.meta,source:JSON.stringify(source)}).pass,false,c.id);}});
