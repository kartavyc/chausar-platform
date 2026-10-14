export function readUiAsset(root: string, pathname: string, enabled: boolean, legacyAvailable?: boolean): Promise<{body: Buffer; mime: string} | null>;
