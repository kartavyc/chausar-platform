export type PromptWeightRow = {
  name: string; purpose: string; site: string;
  instructionChars: number; inputChars: number | null; schemaChars: number | null;
  toolManifestChars?: number; fixedSharePercent: number | null;
};
export function measure(): Promise<PromptWeightRow[]>;
