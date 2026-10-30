// Chausar playbook: Translation and subtitles (Ink v2 wave 5, packages 5J1, 5J2). Its kit definition
// (playbooks/kit/define.ts). Package 5-0 left it null; the package fills every field and passes it through 5A1's
// definePlaybook. Written for Chausar; nothing here is learned from an outside source.
import { definePlaybook } from '../kit/define.ts';
import {TRANSLATION_DATA,TRANSLATION_HI} from './definition-data.ts';

export const TRANSLATION_STUDIO_DEFINITION = definePlaybook(TRANSLATION_DATA,TRANSLATION_HI);
