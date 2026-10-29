// Original website project and exact release records. Browser-safe types only.
import type {WebsiteCheckData} from '../seo-visibility/records.ts';
import type {SiteReleasePlan,SiteReleaseConnection} from './release.ts';
import type {SiteCapturedClient} from './form-capture.ts';
import type {SiteRequirement} from './requirements.ts';import type {SitePreviewState} from './preview.ts';import type {SiteUiEvidence} from './ui-types.ts';
export type SiteModelPreview={callId:string;payloadText:string;digest:string;presetId:string;model:string|null;endpoint:string;estimatedMaxCostMicros:string;estimatedMaxCostDisplay:string;expiresAt:string};
export type SiteRequirementBody={orderId:string;clientId:string;intakeDigest:string;brief:string;pages:string;forms:string;domain:string;repo:{owner:string;name:string};host:string;connection:SiteReleaseConnection|null;requirements:SiteRequirement[];source:{headSha:string;files:Record<string,{text:string;digest:string}>}|null;uiReport:SiteUiEvidence|null;care:{at:string;report:WebsiteCheckData}|null;preview:SitePreviewState;briefApproved:string|null;aiRequest:{kind:'derive'|'audit'|'preview';requirementId:string|null;preview:SiteModelPreview;binding:string}|null;aiCallIds:string[];capture:{active:boolean;notice:string;language:'en'|'hi';tokenHash:string;expiresAt:string;clients:SiteCapturedClient[];imports:Array<{fileId:string;sourceDigest:string;clientIds:string[]}>}|null};
export type SiteReleaseBody=SiteReleasePlan&{projectBinding:string;events:Array<{at:string;line:string}>};
