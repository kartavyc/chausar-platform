// Isolated narration integration: owner intake translations and exact connector guide parity.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {NARRATION_DATA} from '../runtime/venture/playbooks/narration-studio/definition-data.ts';
import {CONNECTOR_CATALOGUE} from '../runtime/venture/build/catalogue.ts';import {guideOf} from '../runtime/venture/build/guides.ts';
const json=(path:string)=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url),'utf8'));
test('all NARRATION_DATA intake labels, help and choices have English display words',()=>{const words=JSON.parse(readFileSync(new URL('../../app/ui/src/text/en/kit-intake-words.json',import.meta.url),'utf8'));const values=new Set(Object.values(words));for(const field of NARRATION_DATA.intakeFields)for(const text of [field.label,field.help,...(field.options??[])])assert.ok(values.has(text),text);});
test('narration connector fake guides equal current native contracts including charges',()=>{const fake=json('app/ui/src/engine/fixtures-guides.json');for(const id of ['google-tts','narration-files','narration-local-checks','narration-distribution']){const item=CONNECTOR_CATALOGUE.find(c=>c.id===id)!;assert.deepEqual(fake[id]?.guide,guideOf(item),id);}});
