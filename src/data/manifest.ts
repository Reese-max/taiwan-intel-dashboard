export interface ScopeFiles {
  events: string;
  map: string;
  network: string;
  eventCount?: number;
  sha256?: string;
}

export interface ManifestFileEntry {
  path: string;
  sha256: string;
  bytes: number;
  count?: number;
  snapshotId?: string;
}

export interface CohortManifest {
  manifestVersion: number;
  snapshotId: string;
  generatedAt: string;
  rulesVersion: string;
  scopes: {
    domestic: ScopeFiles;
    international: ScopeFiles;
  };
  files: Record<string, ManifestFileEntry>;
}

const MANIFEST_FETCH_TIMEOUT_MS = 3_000;

export async function loadManifest(options?: { signal?: AbortSignal; manifestUrl?: string }): Promise<CohortManifest | null> {
  const url = options?.manifestUrl ?? "./data/manifest.json";
  try {
    const timeoutSignal = AbortSignal.timeout(MANIFEST_FETCH_TIMEOUT_MS);
    const signal = options?.signal
      ? typeof AbortSignal.any === "function"
        ? AbortSignal.any([options.signal, timeoutSignal])
        : options.signal
      : timeoutSignal;

    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const json = (await res.json()) as CohortManifest;
    if (!json || json.manifestVersion !== 1 || typeof json.snapshotId !== "string" || !json.snapshotId.trim()) {
      return null;
    }
    return json;
  } catch {
    return null;
  }
}
