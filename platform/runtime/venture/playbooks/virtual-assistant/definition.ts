// Chausar playbook: Virtual assistant service (Ink v2 wave 5, packages 5R1). Its kit definition
// (playbooks/kit/define.ts). Package 5-0 left it null; the package fills every field and passes it through 5A1's
// definePlaybook. Written for Chausar; nothing here is learned from an outside source.
import {definePlaybook} from '../kit/define.ts';
import {VA_DATA,VA_HI} from './definition-data.ts';
export const VIRTUAL_ASSISTANT_DEFINITION=definePlaybook(VA_DATA,VA_HI);
