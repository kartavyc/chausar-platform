export function typeDrift(): { names: string[]; identical: string[]; ui: number; engine: number };
export function declarations(path: string): Map<string, { start: number; end: number; text: string }>;
