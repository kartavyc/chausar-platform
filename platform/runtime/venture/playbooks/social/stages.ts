// Writing-artifact stages only. Code, approval and handoff steps never create model runs.
export const SOCIAL_CHAIN_STAGES:Readonly<Record<string,readonly string[]>>={
 'content-calendar':['voice','calendar','drafts'],'community-replies':['voice','drafts'],'ugc-ads':['voice','creative-briefs'],
 'monthly-report':['report'],'repurpose-pack':['voice','drafts'],'linkedin-ghostwriting':['voice','calendar','drafts'],
};
export function socialStages(offerKey:string|null|undefined):readonly string[]{return SOCIAL_CHAIN_STAGES[offerKey??'']??['drafts'];}
