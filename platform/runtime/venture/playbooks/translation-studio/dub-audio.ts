// Original shared read-only binding of measured audio to this order's saved bytes.
import {createHash} from 'node:crypto';
import {check} from '../../../contracts.ts';
import {listRecords} from '../../records.ts';
import type {currentDub} from './dub-runtime.ts';
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export function currentDubAudio(live:ReturnType<typeof currentDub>,sentenceId:string){const row=live.group.sentences.find(s=>s.id===sentenceId);check(row?.audioFileId&&row.audioDigest,'DUB_AUDIO_REQUIRED','Make this sentence before verifying it.');const file=listRecords(live.state,'venture-upload',live.venture.id).find(f=>f.id===row.audioFileId&&f.scope.kind==='order'&&f.scope.orderId===live.order.id);check(file,'DUB_AUDIO_REQUIRED','This sentence audio is missing.');const bytes=Buffer.from(file.contentBase64,'base64');check(sha(bytes)===row.audioDigest,'DERIVED_STALE','The audio changed. Make a fresh source-bound sentence.');return {row,bytes};}
