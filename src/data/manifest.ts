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

export function validateCohortManifest(json: unknown): json is CohortManifest {
  if (!json || typeof json !== "object") return false;
  const m = json as Partial<CohortManifest>;
  if (m.manifestVersion !== 1) return false;
  if (typeof m.snapshotId !== "string" || !m.snapshotId.trim()) return false;
  if (typeof m.generatedAt !== "string" || !m.generatedAt.trim()) return false;
  if (typeof m.rulesVersion !== "string" || !m.rulesVersion.trim()) return false;
  if (!m.scopes || typeof m.scopes !== "object") return false;
  if (!m.scopes.domestic || typeof m.scopes.domestic !== "object") return false;
  if (!m.scopes.international || typeof m.scopes.international !== "object") return false;
  if (typeof m.scopes.domestic.events !== "string" || !m.scopes.domestic.events.trim()) return false;
  if (typeof m.scopes.domestic.map !== "string" || !m.scopes.domestic.map.trim()) return false;
  if (typeof m.scopes.domestic.network !== "string" || !m.scopes.domestic.network.trim()) return false;
  if (typeof m.scopes.international.events !== "string" || !m.scopes.international.events.trim()) return false;
  if (typeof m.scopes.international.map !== "string" || !m.scopes.international.map.trim()) return false;
  if (typeof m.scopes.international.network !== "string" || !m.scopes.international.network.trim()) return false;
  if (!m.files || typeof m.files !== "object") return false;
  return true;
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
    const json = await res.json();
    if (!validateCohortManifest(json)) {
      return null;
    }
    return json;
  } catch {
    return null;
  }
}
