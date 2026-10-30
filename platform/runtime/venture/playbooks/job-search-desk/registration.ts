// Chausar playbook: Job-search and career desk (Ink v2 wave 5, package 5I). The registry entry, with no runtime
// imports. Package 5-0 left it null, so the playbook is not registered and has no tile; the package sets its id
// ('job-search-desk'), label, service type, picks, summary, risk level and review day (the plan's "Registration" line).
// Written for Chausar; nothing here is learned from an outside source.
import type { PlaybookRegistration } from '../registry.ts';

export const JOB_SEARCH_DESK_REGISTRATION: PlaybookRegistration = {id:'job-search-desk',label:'Job-search and career desk',serviceType:'consulting',picks:['job search help','career coach','career coaching','resume writing','cv writing','interview prep','job hunt'],summary:'Agents prepare sourced shortlists, resumes and outreach drafts. You approve every claim and pack. The client sends and applies.',riskLevel:'high',lastReviewed:'2026-10-29'};
