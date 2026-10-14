import type { ImportSource } from "@/types/admin";
import { loadCatalog, loadSources, mutateCatalog, mutateSources } from "@/lib/store";
import { describeMerge, fetchArchiveCandidates, fetchYouTubeCandidates, mergeIntoCatalog } from "@/lib/admin/importers";
import { defaultTerritories } from "@/lib/admin/form";

export function requireYouTubeKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY is not set in .env.local (restart the server after adding it).");
  return key;
}

/** Fetches new titles for one saved source and merges them. Trusted sources publish automatically. */
export async function syncSource(source: ImportSource): Promise<string> {
  let message: string;
  try {
    const existingIds = new Set(loadCatalog().raw.map((r) => String(r.id)));
    const candidates =
      source.kind === "archive"
        ? await fetchArchiveCandidates({ industry: source.industry, query: source.target, rows: source.maxPerSync ?? 30 })
        : await fetchYouTubeCandidates(
            {
              key: requireYouTubeKey(),
              industry: source.industry,
              type: source.contentType,
              target: source.target,
              minMinutes: source.minMinutes,
              max: source.maxPerSync ?? 50,
            },
            existingIds,
          );
    const approve = source.trusted
      ? {
          reviewer: "auto (trusted source: " + source.label + ")",
          territories: source.territories.length > 0 ? source.territories : defaultTerritories(),
        }
      : undefined;
    const result = await mutateCatalog((records) => mergeIntoCatalog(records, candidates, { approve }));
    message = describeMerge(result);
  } catch (error) {
    message = "Failed: " + (error instanceof Error ? error.message : String(error));
  }
  await mutateSources((list) => {
    const saved = list.find((s) => s.id === source.id);
    if (saved) {
      saved.lastSyncAt = new Date().toISOString();
      saved.lastResult = message;
    }
  });
  return source.label + ": " + message;
}

export async function syncAllSources(): Promise<string[]> {
  const results: string[] = [];
  for (const source of loadSources()) {
    results.push(await syncSource(source));
  }
  return results;
}
