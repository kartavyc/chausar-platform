/**
 * Every place, by id. Each place lives in src/places/<place>/index.tsx and exports `Place`; it may also export
 * `sheets`, a map of sheet kinds it owns (for example `agent` from Team, `client` from Clients). Phase 2 agents edit
 * only their own place folder; this file does not change when a place grows.
 */

import type { ComponentType } from 'react';
import * as business from '../places/business';
import * as clients from '../places/clients';
import * as connections from '../places/connections';
import * as money from '../places/money';
import * as onboarding from '../places/onboarding';
import * as team from '../places/team';
import * as today from '../places/today';
import * as work from '../places/work';
import { BASE_SHEETS, type SheetComponent } from './sheets';
import type { PlaceId } from './routes';

export interface PlaceModule { Place: ComponentType; sheets?: Readonly<Record<string, SheetComponent>> }

export const PLACES: Readonly<Record<PlaceId, PlaceModule>> = { today, team, work, clients, money, connections, business, onboarding };

/** All sheet kinds: the foundation's, then each place's. A place may not replace `run` or `receipt`. */
export const SHEETS: Readonly<Record<string, SheetComponent>> = Object.assign(
  {},
  ...Object.values(PLACES).map((place) => place.sheets ?? {}),
  BASE_SHEETS,
);
