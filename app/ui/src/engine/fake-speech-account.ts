// Memory-only fake speech account identity shared by narration and dubbing. Never exposes its key.
import {digest} from '../../../../platform/runtime/portable';import type {W4DeskHost} from './fake-w4';
const accounts=new WeakMap<W4DeskHost,string>();
export function setFakeSpeechAccount(host:W4DeskHost,key:string|null){if(key===null)accounts.delete(host);else accounts.set(host,digest(key));}
export const fakeSpeechAccount=(host:W4DeskHost)=>accounts.get(host)??null;
