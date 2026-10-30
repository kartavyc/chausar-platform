// Browser mirror of the existing local video intake, combined with exact screencast service fields.
import {EngineError,type OfferIntakeLite,type OrderLite,type VoiceConsentsView} from './types';
import {fakeKitIntake} from './fake-kit-intake';
import {localPathProblem} from '../../../../platform/runtime/local-paths';
export function fakeYoutubeMediaIntake(raw:unknown,ask:OfferIntakeLite,meta:{by:string;at:string;today:string;hosted?:boolean},consents:()=>VoiceConsentsView):NonNullable<OrderLite['intake']>{
 const fail=(line:string):never=>{throw new EngineError('INVALID_VENTURE_REQUEST',line);};
 if(raw!==undefined&&(!raw||typeof raw!=='object'||Array.isArray(raw)))fail('Send the intake as named fields.');
 const {fields,moneyRupees,...base}=(raw??{}) as Record<string,unknown>;
 const own=fakeKitIntake({fields,...(moneyRupees===undefined?{}:{moneyRupees})},{...ask,rights:[]},consents,meta)!;
 const extra=Object.keys(base).find(key=>!['rights','format','aiVoice','aiPresenter','paidPromotion','cutFile','calendar','clientRules'].includes(key));
 if(extra)fail(`The intake has no field called ${extra}.`);
 const rights=fakeKitIntake({rights:base.rights},{rights:ask.rights,fields:[],kit:[]},consents,meta)!.rights;
 if(base.format!==undefined&&base.format!=='long'&&base.format!=='short')fail('Choose a long video or Shorts.');
 const flag=(key:string,label:string)=>{if(base[key]!==undefined&&typeof base[key]!=='boolean')fail(`Say yes or no to ${label}.`);return base[key]===true;};
 const aiVoice=flag('aiVoice','an AI voice'),aiPresenter=flag('aiPresenter','an AI presenter'),paidPromotion=flag('paidPromotion','paid promotion');
 let cutFile:string|null=null;
 if(base.cutFile!==undefined&&base.cutFile!==null){
  if(meta.hosted)fail("The hosted server can't read a file on your computer. Name the cut in the desktop app.");
  const problem=localPathProblem(base.cutFile,'win32');if(problem)fail(`The cut: ${problem}`);
  if(typeof base.cutFile!=='string'||!/[.](mp4|mov|m4v|mkv|webm)$/i.test(base.cutFile))fail('Name the cut as a full path to an MP4, MOV, M4V, MKV or WEBM file on this computer.');
  cutFile=base.cutFile as string;
 }
 if(base.calendar!==undefined&&base.calendar!==null)fail('This offer posts on no calendar, so it takes none.');
 if(base.clientRules!==undefined&&base.clientRules!==null)fail('This offer reads no word lists from the client.');
 return {...own,rights,format:base.format==='short'?'short':'long',aiVoice,aiPresenter,paidPromotion,cutFile};
}
