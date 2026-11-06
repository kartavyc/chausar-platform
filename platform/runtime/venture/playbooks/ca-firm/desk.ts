// Chausar flagship playbook: AI-native CA firm (Ink v2 wave 5, packages 5C1, 5C2). Its desk: the handlers
// venture.desk.list, .get and .act reach for its own record kinds (playbooks/desks.ts), and their types
// (playbooks/desk-types.ts). Package 5-0 left it empty, so every desk method for this playbook answers NOT_BUILT_YET.
// Written for Chausar; nothing here is learned from an outside source.
import type { DeskHandlers,DeskKindTypes } from '../desk-types.ts';
import {DATA_PACK_DESK} from './data-pack.ts';
import {CA_WORK_DESK} from './work-desk.ts';

/** This desk's record kinds, each a DeskKindTypes (desk-types.ts) by kind; none until a package adds one. */
export type CaFirmDeskTypes = {'data-pack':DeskKindTypes;working:DeskKindTypes};
/** This desk's handlers by record kind; none until a package adds one. */
export const CA_FIRM_DESK: DeskHandlers = Object.freeze({...DATA_PACK_DESK,...CA_WORK_DESK});
