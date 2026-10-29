// Original honest capability boundary. No provider account, Indian number or hosted webhook is qualified here.
export const VOICE_CALLS_CAPABILITY=Object.freeze({label:'planned' as const,direction:'write' as const,reason:'An owner-owned Indian number, KYC, authenticated hosted webhook and exact provider prices still need verification.',manual:'Use your phone own call forwarding; the approved script is ready to read.'});
export type VoiceCallResponse={callId:string;decision:'admit'|'forward';forwardNumber:string|null;scriptDigest:string;script:string[]};
/** A trusted provider adapter must call the synchronous guard immediately before releasing its one physical response. */
export type VoiceCallsPort={accountId:string;respond(input:VoiceCallResponse,beforeDispatch:()=>void,signal:AbortSignal):Promise<void>};
/** Explicit test double only. No production host constructs this or advertises it as a qualified connection. */
export class FakeVoiceCallsPort implements VoiceCallsPort{
 readonly accountId='fake-voice-account';readonly responses:VoiceCallResponse[]=[];
 private readonly before:(()=>Promise<void>)|undefined;private readonly failAfterDispatch:boolean;
 constructor(before?:()=>Promise<void>,failAfterDispatch=false){this.before=before;this.failAfterDispatch=failAfterDispatch;}
 async respond(input:VoiceCallResponse,beforeDispatch:()=>void,signal:AbortSignal){const exact=structuredClone(input);await this.before?.();signal.throwIfAborted();beforeDispatch();this.responses.push(exact);if(this.failAfterDispatch)throw new Error('Fake provider response lost after dispatch');}
}
