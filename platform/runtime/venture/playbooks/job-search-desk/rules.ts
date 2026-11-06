// Original career client-use gate. Practice never authorizes sharing actual client data.
import {requireConfirmedRules} from '../kit/rules.ts';
import {CAREER_PRIVACY_RULE} from './definition-data.ts';
import type {AttestedRules} from '../kit/attestation.ts';
/** W6 6C5: the owner's attestation of the privacy rule unlocks client work. */
export function requireCareerClientRule(attested?:AttestedRules){requireConfirmedRules([CAREER_PRIVACY_RULE],['tailor'],'client',attested);}
