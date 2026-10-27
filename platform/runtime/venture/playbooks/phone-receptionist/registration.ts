// Chausar playbook: AI phone receptionist (Ink v2 wave 5, package 5R6). The registry entry, with no runtime imports.
// Package 5-0 left it null, so the playbook is not registered and has no tile; the package sets its id
// ('phone-receptionist'), label, service type, picks, summary, risk level and review day (the plan's "Registration"
// line). Written for Chausar; nothing here is learned from an outside source.
import type { PlaybookRegistration } from '../registry.ts';

export const PHONE_RECEPTIONIST_REGISTRATION: PlaybookRegistration | null = null;
