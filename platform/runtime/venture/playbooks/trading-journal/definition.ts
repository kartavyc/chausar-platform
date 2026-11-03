// Chausar playbook: trading journal (wave 6, 6E7 / D49). The kit validates every field and dated rule.
import { definePlaybook } from '../kit/define.ts';
import { TRADING_JOURNAL_DATA } from './definition-data.ts';

export const TRADING_JOURNAL_DEFINITION = definePlaybook(TRADING_JOURNAL_DATA);
