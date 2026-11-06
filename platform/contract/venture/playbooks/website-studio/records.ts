// Canonical browser-safe types, shared by the engine and renderer.
import type { SiteReleaseConnection } from '../../../../shared/venture/playbooks/website-studio/release.ts';
import type { SiteRequirement } from '../../../../shared/venture/playbooks/website-studio/requirements.ts';
import type { SiteUiEvidence } from './ui-types.ts';
import type { WebsiteCheckData } from '../seo-visibility/records.ts';
import type { SitePreviewState } from '../../../../shared/venture/playbooks/website-studio/preview.ts';
import type { SiteCapturedClient } from '../../../../shared/venture/playbooks/website-studio/form-capture.ts';

export type SiteRequirementBody={orderId:string;clientId:string;intakeDigest:string;brief:string;pages:string;forms:string;domain:string;repo:{owner:string;name:string};host:string;connection:SiteReleaseConnection|null;requirements:SiteRequirement[];source:{headSha:string;files:Record<string,{text:string;digest:string}>}|null;uiReport:SiteUiEvidence|null;care:{at:string;report:WebsiteCheckData}|null;preview:SitePreviewState;briefApproved:string|null;aiRequest:{kind:'derive'|'audit'|'preview';requirementId:string|null;preview:SiteModelPreview;binding:string}|null;aiCallIds:string[];capture:{active:boolean;notice:string;language:'en'|'hi';tokenHash:string;expiresAt:string;clients:SiteCapturedClient[];imports:Array<{fileId:string;sourceDigest:string;clientIds:string[]}>}|null};

export type SiteModelPreview={clientAi?:import('../../../../shared/venture/clients/ai-consent-core.ts').ClientAiContextBinding;callId:string;payloadText:string;digest:string;presetId:string;model:string|null;endpoint:string;estimatedMaxCostMicros:string;estimatedMaxCostDisplay:string};
