export function contractArtifacts(): Promise<Map<string, string>>;
export function generateContract(options?: { outputRoot?: string }): Promise<void>;
export function checkGenerated(options?: { outputRoot?: string }): Promise<string[]>;
