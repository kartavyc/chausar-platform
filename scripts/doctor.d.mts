// Types for scripts/doctor.mjs (D11): the developer loop's checks.
export const MIN_NODE: string;
export type DoctorLine = { name: string; ok: boolean; text: string; fix?: string; required?: boolean };
export function doctor(options?: { root?: string; env?: Readonly<Record<string, string | undefined>>; nodeVersion?: string; platform?: NodeJS.Platform }): Promise<DoctorLine[]>;
