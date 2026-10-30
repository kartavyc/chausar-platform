// Original career client-use gate. Practice never authorizes sharing actual client data.
import {requireConfirmedRules} from '../kit/rules.ts';
import {CAREER_PRIVACY_RULE} from './definition-data.ts';
export function requireCareerClientRule(){requireConfirmedRules([CAREER_PRIVACY_RULE],['tailor'],'client');}
