// Original Chausar browser-safe social production views. Stored with the owning order.
import type { CrossPostPlan } from './cross-post.ts';
export type ReelPlan={cuts:{clipId:string;startMs:number;durationMs:number;timelineMs:number}[];captions:string;durationMs:number;endCard:{contact:string;durationMs:number};hook:string;capability:'desktop'};
export type ReelJob={sources:{id:string;digest:string;durationMs:number;hasAudio:boolean}[];plan:ReelPlan;output:string;approvedDigest:string|null;rendered:{path:string;digest:string}|null};
export type SocialAdPlan={photo:{id:string;digest:string;kind:'client'};category:string;style:string;stills:{id:string;digest:string}[];boardDigest:string;approvedDigest:string|null;quote:{units:number;totalMinor:string;display:string;receiptId:string;disclosure:string|null;formula:string;capability:'handoff';providerCalled:false}|null};
export type SocialProduction={cross:CrossPostPlan|null;reel:ReelJob|null;ad:SocialAdPlan|null};
export type SocialProductionView={id:string;request:string;digest:string;production:SocialProduction;capability:'handoff';videoUpload:'planned'};
export const emptySocialProduction=():SocialProduction=>({cross:null,reel:null,ad:null});
