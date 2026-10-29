// Original tender kit activation validates every field, dated rule and Hindi translation.
import {definePlaybook} from '../kit/define.ts';
import {TENDER_DATA} from './definition-data.ts';

export const TENDER_DESK_DEFINITION = definePlaybook(TENDER_DATA);
