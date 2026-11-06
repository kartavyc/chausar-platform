export interface ShippedPackage { name: string; version: string; license: string; platformSpecific: boolean; path: string }
export function licenceVerdict(license: string | undefined): { verdict: 'compatible' | 'incompatible' | 'unknown'; reason: string };
export function collectShippedPackages(root: string): ShippedPackage[];
export function renderNotice(shipped: ShippedPackage[], root: string): string;
export function fontLicenceProblems(root: string): string[];
export function writeFontLicences(root: string): void;
