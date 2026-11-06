// Plain error wording shared by browser screens. No IO or runtime authority.
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
