export function validate(workspaceId: unknown, name: unknown, value?: unknown, setting?: boolean): void;
export function failure(code: string): Error & { code: string };
