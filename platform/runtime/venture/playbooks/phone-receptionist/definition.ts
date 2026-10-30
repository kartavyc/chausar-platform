// Chausar playbook: AI phone receptionist (Ink v2 wave 5, packages 5R6). Its kit definition (playbooks/kit/define.ts).
// Package 5-0 left it null; the package fills every field and passes it through 5A1's definePlaybook. Written for
// Chausar; nothing here is learned from an outside source.
import {definePlaybook} from '../kit/define.ts';import {PHONE_DATA} from './definition-data.ts';import {PHONE_HI} from './words.ts';

export const PHONE_RECEPTIONIST_DEFINITION=definePlaybook(PHONE_DATA,PHONE_HI);
