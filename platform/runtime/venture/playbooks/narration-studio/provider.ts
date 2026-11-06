// Original owner-only speech credential boundary. Google v1 discovery and pricing read 2026-10-29.
import {check,type Context} from '../../../contracts.ts';
import type {VentureDeps} from '../../contracts.ts';
import {exactPayload,requireAppChannel,ventureAction} from '../../records.ts';
/** Store or remove only the Google speech secret after the owner explicitly saves the connection. No test call. */
export async function configureNarrationSpeech(deps:VentureDeps,ctx:Context,payload:unknown){
 requireAppChannel(ctx,'venture.desk.act');check(ctx.role==='owner'||ctx.role==='cofounder','APP_APPROVAL_REQUIRED','Only the owner connects a speech account.');
 const body=exactPayload(payload,['key','clear']);
 if(body.clear!==undefined)check(body.clear===true&&body.key===undefined,'INVALID_VENTURE_REQUEST','Send clear alone to remove the speech key.');
 else check(typeof body.key==='string'&&body.key.length>=12&&body.key.length<=500&&!/\s/.test(body.key),'INVALID_VENTURE_REQUEST','Paste your Google Cloud API key.');
 return ventureAction(deps,ctx,'approve','narration.speech-connect',tx=>{if(body.clear===true)deps.secrets.delete('speech:google-tts');else deps.secrets.set('speech:google-tts',body.key as string);tx.emit('desk.changed',{playbook:'narration-studio'});return {provider:'google-tts',connected:body.clear!==true,providerCalled:false};});
}
