// Browser metadata for the lesson desk and the booking desk (wave 6, 6E2 and 6E3): the very offers, intake questions
// and registry data their kit definitions use, read from the playbooks' import-free meta.ts files, so the fake's
// onboarding plans match the engine's.
import { LESSON_REGISTRATION_DATA, LESSON_INTAKE_FIELDS, LESSON_OFFERS } from '../../../../platform/shared/venture/playbooks/lesson-desk/meta.ts';
import type { MetaField } from '../../../../platform/runtime/venture/playbooks/lesson-desk/meta.ts';
import { BOOKING_REGISTRATION_DATA, BOOKING_INTAKE_FIELDS, BOOKING_OFFERS } from '../../../../platform/shared/venture/playbooks/booking-desk/meta.ts';
import type { FakeKitMetadata } from './fake-kit-plans';

/** The browser's intake question shape keeps a plain list of options. */
const fields = (list: readonly MetaField[]) => list.map(({ options, ...field }) => ({ ...field, ...(options ? { options: [...options] } : {}) }));

export const LESSON_META: FakeKitMetadata = { registration: LESSON_REGISTRATION_DATA, offers: LESSON_OFFERS, intakeFields: fields(LESSON_INTAKE_FIELDS) };
export const BOOKING_META: FakeKitMetadata = { registration: BOOKING_REGISTRATION_DATA, offers: BOOKING_OFFERS, intakeFields: fields(BOOKING_INTAKE_FIELDS) };
