// Original tests for the documented Google v1 request. Network fixtures never contact a provider.
import test from 'node:test';import assert from 'node:assert/strict';
import {setup,owner} from './venture-views-env.ts';
import {SPEECH_PROVIDERS,speechQuote,speechSay,speechProviders} from '../runtime/venture/build/speech-out.ts';
import {configureNarrationSpeech} from '../runtime/venture/playbooks/narration-studio/provider.ts';
test('owner can configure the qualified speech route without network or exposing the secret',async()=>{const e=await setup(),key=['fixture','speech','only'].join('-');let calls=0;e.deps.net={resolve:async()=>{calls++;return [];}};
 await assert.rejects(configureNarrationSpeech(e.deps,{...owner,channel:'agent'} as never,{key}),{code:'APP_APPROVAL_REQUIRED'});
 const result=await configureNarrationSpeech(e.deps,owner,{key});assert.equal(result.connected,true);assert.equal(JSON.stringify(result).includes(key),false);assert.equal(calls,0);assert.equal((await speechProviders(e.deps,owner,{})).providers.find(p=>p.id==='google-tts')!.label,'write');
 assert.equal((await configureNarrationSpeech(e.deps,owner,{clear:true})).connected,false);
});
test('Google stock speech uses dated list price, byte limit and exact documented request',async()=>{const e=await setup(),key=['fixture','speech','only'].join('-');await configureNarrationSpeech(e.deps,owner,{key});const provider=SPEECH_PROVIDERS.find(p=>p.id==='google-tts')!;const quote=speechQuote(provider,'hi-IN-Standard-A','नमस्ते');assert.equal(quote.micros,String([...('नमस्ते')].length*4));assert.equal(quote.price.checkedOn,'2026-10-29');let calls=0;
 e.deps.net={resolve:async()=>[{address:'142.250.1.10',family:4}],send:async target=>{calls++;assert.equal(target.headers['x-goog-api-key'],key);const body=JSON.parse(String(target.body));assert.equal(body.voice.name,'hi-IN-Standard-A');assert.equal(body.voice.languageCode,'hi-IN');assert.equal(body.input.text,'नमस्ते');return {status:200,headers:{'content-type':'application/json'},body:Buffer.from(JSON.stringify({audioContent:Buffer.from('ID3 fixture audio').toString('base64')}))};}};
 await speechSay(e.deps,owner,{provider:'google-tts',voice:{stock:'hi-IN-Standard-A'},text:'नमस्ते',quoted:quote.textDigest});assert.equal(calls,1);
 const tooLong='ह'.repeat(2000);await assert.rejects(speechSay(e.deps,owner,{provider:'google-tts',voice:{stock:'hi-IN-Standard-A'},text:tooLong,quoted:'x'}),{code:'SPEECH_TOO_LONG'});assert.equal(calls,1);
});
