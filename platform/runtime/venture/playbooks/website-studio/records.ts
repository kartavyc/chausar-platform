import type { SiteRequirementBody, SiteModelPreview } from '../../../../contract/venture/playbooks/website-studio/records.ts';
export type { SiteRequirementBody, SiteModelPreview } from '../../../../contract/venture/playbooks/website-studio/records.ts';
// Original website project and exact release records. Browser-safe types only.
import type {WebsiteCheckData} from '../seo-visibility/records.ts';
import type {SiteReleasePlan,SiteReleaseConnection} from './release.ts';
import type {SiteCapturedClient} from './form-capture.ts';
import type {SiteRequirement} from './requirements.ts';import type {SitePreviewState} from './preview.ts';import type {SiteUiEvidence} from './ui-types.ts';


export type SiteReleaseBody=SiteReleasePlan&{projectBinding:string;events:Array<{at:string;line:string}>};
