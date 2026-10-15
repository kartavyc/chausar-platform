import type { MethodSpec } from '../modules/types.ts';
import { clientMethods } from './client.ts';
import { firmMethods } from './firm.ts';
/** CA console methods: firm side (firm.*, clients.*) and client side (castatus.*). */
export const caMethods: Readonly<Record<string, MethodSpec>> = { ...clientMethods, ...firmMethods };
