// Chausar playbook: Virtual assistant service (Ink v2 wave 5, package 5R1). The registry entry, with no runtime
// imports. Package 5-0 left it null, so the playbook is not registered and has no tile; the package sets its id
// ('virtual-assistant'), label, service type, picks, summary, risk level and review day (the plan's "Registration"
// line). Written for Chausar; nothing here is learned from an outside source.
import type { PlaybookRegistration } from '../registry.ts';

export const VIRTUAL_ASSISTANT_REGISTRATION:PlaybookRegistration={id:'virtual-assistant',label:'Virtual assistant service',serviceType:'support',picks:['virtual assistant','personal assistant service','errands service','executive assistant service'],summary:'Agents keep client routines, reminders and research moving; you approve every send and purchase.',riskLevel:'medium',lastReviewed:'2026-10-29'};
