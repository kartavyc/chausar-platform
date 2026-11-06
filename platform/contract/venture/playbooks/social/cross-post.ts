// Canonical browser-safe types, shared by the engine and renderer.


export type CrossPostPlan={video:{id:string;digest:string;kind:'client'};posts:{platform:string;text:string;ownerApproved:boolean;clientApproved:boolean}[];capability:'handoff';upload:'planned'};
