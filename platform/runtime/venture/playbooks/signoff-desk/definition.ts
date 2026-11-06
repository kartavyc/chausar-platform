// Chausar playbook: the sign-off desk (wave 6, 6E5). The kit validates every field and dated rule.
import {definePlaybook} from '../kit/define.ts';
import {SIGNOFF_DATA} from './definition-data.ts';

export const SIGNOFF_DESK_DEFINITION=definePlaybook(SIGNOFF_DATA);
