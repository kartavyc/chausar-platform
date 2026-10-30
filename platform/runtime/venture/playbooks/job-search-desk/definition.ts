// Chausar playbook: Job-search and career desk (Ink v2 wave 5, packages 5I). Its kit definition
// (playbooks/kit/define.ts). Package 5-0 left it null; the package fills every field and passes it through 5A1's
// definePlaybook. Written for Chausar; nothing here is learned from an outside source.
import {definePlaybook} from '../kit/define.ts';
import {CAREER_DATA,CAREER_HI} from './definition-data.ts';
export const JOB_SEARCH_DESK_DEFINITION=definePlaybook(CAREER_DATA,CAREER_HI);
